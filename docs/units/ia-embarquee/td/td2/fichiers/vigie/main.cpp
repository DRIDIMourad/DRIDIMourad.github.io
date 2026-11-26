/* main.cpp (TD2, partie 9) : drone VIGIE, des taches periodiques et MobileNet sur le NPU */
#include <string.h>
#include "board_init.h"
#include "board.h"
#include "demo_config.h"
#include "demo_info.h"
#include "fsl_debug_console.h"
#include "fsl_gpio.h"
#include "fsl_port.h"
#include "model.h"
#include "get_top_n.h"
#include "labels.h"
#include "timer.h"
#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"
#include "outils_rtos.h"

/* Les images de la "camera" : plusieurs images (images_data.h, script img2c_multi.py)
   si le fichier existe, sinon l'image d'origine de l'exemple (image_data.h). */
#if __has_include("images_data.h")
#include "images_data.h" /* NB_IMAGES, images[], noms_images[] */
#else
#include "image_data.h"  /* image_data[], STATIC_IMAGE_NAME */
#define NB_IMAGES 1
static const uint8_t* const images[NB_IMAGES]   = {image_data};
static const char* const noms_images[NB_IMAGES] = {STATIC_IMAGE_NAME};
#endif

/* ===== Reglages a modifier pendant les experiences ===== */
#define PERIODE_STAB_MS     10   /* stabilisation : 100 fois par seconde */
#define CALCUL_STAB_MS      1    /* duree du calcul de la stabilisation */
#define PERIODE_CAMERA_MS   500  /* une photo toutes les 500 ms */
#define PERIODE_MONITEUR_MS 5000

#define PRIO_STAB     4 /* de 0 (la plus basse) a 4 (la plus haute) */
#define PRIO_CAMERA   3
#define PRIO_VISION   2
#define PRIO_RADIO    1
#define PRIO_MONITEUR 1

#define PILE_STAB     256  /* en mots de 4 octets */
#define PILE_CAMERA   256
#define PILE_VISION   2048 /* l'inference TensorFlow Lite Micro a besoin de pile */
#define PILE_RADIO    512
#define PILE_MONITEUR 512

#define LONGUEUR_FILE_IMAGES    2
#define LONGUEUR_FILE_RESULTATS 4
#define SEUIL_DETECTION         DETECTION_TRESHOLD /* en %, 23 dans demo_config.h */
static const char* const CIBLES[] = {"stopwatch"}; /* objets recherches par le drone */
/* ======================================================== */

#define NB_CIBLES (sizeof(CIBLES) / sizeof(CIBLES[0]))

#define ROUGE 1 /* couleurs de la LED RGB (TD1) */
#define VERT  2
#define BLEU  4

typedef struct /* une photo, de la tache Camera vers la tache Vision */
{
    uint32_t numero;
    const uint8_t* pixels; /* 128 x 128 x 3 octets RGB, en Flash */
    const char* nom;
    uint32_t t_capture_us;
    bool demande; /* true = photo demandee par SW2 */
} trame_t;

typedef struct /* un resultat, de la tache Vision vers la tache Radio */
{
    uint32_t numero;
    const char* nom;
    int classe; /* indice dans labels[], -1 si rien au-dessus du seuil */
    int score;  /* en % */
    uint32_t t_inference_us;
    uint32_t latence_us; /* de la capture a la fin de l'inference */
    bool demande;
} resultat_t;

static QueueHandle_t file_images, file_resultats;
static TaskHandle_t h_camera;

static uint8_t* g_entree; /* tenseur d'entree du modele */
static tensor_dims_t g_dims_entree;
static tensor_type_t g_type_entree;
static uint8_t* g_sortie; /* tenseur de sortie du modele */
static tensor_dims_t g_dims_sortie;
static tensor_type_t g_type_sortie;

/* Statistiques lues par le moniteur */
static volatile uint32_t g_stab_retards = 0, g_stab_gigue_max_us = 0;
static volatile uint32_t g_images_perdues = 0, g_resultats_perdus = 0;
static volatile uint32_t g_inf_min_us = 0xFFFFFFFFu, g_inf_max_us = 0, g_inf_total_us = 0, g_nb_inferences = 0;

static unsigned Temps_ms(void)
{
    return (unsigned)(Temps_us() / 1000U);
}

/* ---------- LED RGB (TD1) ---------- */
static void LED_Init(void)
{
    gpio_pin_config_t sortie = {kGPIO_DigitalOutput, 1}; /* 1 = LED eteinte */
    CLOCK_EnableClock(kCLOCK_Port0);
    CLOCK_EnableClock(kCLOCK_Port1);
    CLOCK_EnableClock(kCLOCK_Gpio0);
    CLOCK_EnableClock(kCLOCK_Gpio1);
    PORT_SetPinMux(PORT0, BOARD_LED_RED_GPIO_PIN, kPORT_MuxAlt0);
    PORT_SetPinMux(PORT0, BOARD_LED_GREEN_GPIO_PIN, kPORT_MuxAlt0);
    PORT_SetPinMux(PORT1, BOARD_LED_BLUE_GPIO_PIN, kPORT_MuxAlt0);
    GPIO_PinInit(BOARD_LED_RED_GPIO, BOARD_LED_RED_GPIO_PIN, &sortie);
    GPIO_PinInit(BOARD_LED_GREEN_GPIO, BOARD_LED_GREEN_GPIO_PIN, &sortie);
    GPIO_PinInit(BOARD_LED_BLUE_GPIO, BOARD_LED_BLUE_GPIO_PIN, &sortie);
}

static void LED_Couleur(int couleur)
{
    GPIO_PinWrite(BOARD_LED_RED_GPIO, BOARD_LED_RED_GPIO_PIN, (couleur & ROUGE) ? 0 : 1);
    GPIO_PinWrite(BOARD_LED_GREEN_GPIO, BOARD_LED_GREEN_GPIO_PIN, (couleur & VERT) ? 0 : 1);
    GPIO_PinWrite(BOARD_LED_BLUE_GPIO, BOARD_LED_BLUE_GPIO_PIN, (couleur & BLEU) ? 0 : 1);
}

/* ---------- Bouton SW2 : photo a la demande ---------- */
static void BOUTON_Init(void)
{
    gpio_pin_config_t entree = {kGPIO_DigitalInput, 0};
    /* les horloges du port 0 et du GPIO0 sont deja activees par LED_Init() */
    PORT0->PCR[BOARD_SW2_GPIO_PIN] = PORT_PCR_MUX(0) | PORT_PCR_IBE_MASK | PORT_PCR_PE_MASK | PORT_PCR_PS_MASK;
    GPIO_SetPinInterruptConfig(GPIO0, BOARD_SW2_GPIO_PIN, kGPIO_InterruptFallingEdge);
    GPIO_PinInit(GPIO0, BOARD_SW2_GPIO_PIN, &entree);
    NVIC_SetPriority(BOARD_SW2_IRQ, 3); /* >= configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY (2) */
    EnableIRQ(BOARD_SW2_IRQ);
}

/* extern "C" : on est dans un fichier C++, mais la table des interruptions attend un nom C */
extern "C" void GPIO00_IRQHandler(void)
{
    static uint32_t dernier_us = 0;
    BaseType_t reveil          = pdFALSE;
    uint32_t flags             = GPIO_GpioGetInterruptFlags(GPIO0);

    GPIO_GpioClearInterruptFlags(GPIO0, flags);
    if ((flags & (1U << BOARD_SW2_GPIO_PIN)) && (Temps_us() - dernier_us > 300000U)) /* anti-rebond 300 ms */
    {
        dernier_us = Temps_us();
        vTaskNotifyGiveFromISR(h_camera, &reveil); /* reveille la camera tout de suite */
    }
    portYIELD_FROM_ISR(reveil);
    SDK_ISR_EXIT_BARRIER;
}

/* ---------- Tache STAB : periodique, courte, la plus urgente ---------- */
static void tache_stab(void* pv)
{
    uint32_t n        = 0;
    uint32_t t0       = Temps_us();
    TickType_t reveil = xTaskGetTickCount();
    for (;;)
    {
        /* gigue = retard entre l'instant prevu et l'instant reel du reveil */
        uint32_t prevu = t0 + n * PERIODE_STAB_MS * 1000U;
        uint32_t gigue = Temps_us() - prevu;
        if (n > 0 && gigue > g_stab_gigue_max_us)
            g_stab_gigue_max_us = gigue;
        n++;
        Calcul(CALCUL_STAB_MS); /* lit les capteurs, corrige les moteurs */
        if (xTaskDelayUntil(&reveil, pdMS_TO_TICKS(PERIODE_STAB_MS)) == pdFALSE)
            g_stab_retards++; /* echeance ratee */
    }
}

/* ---------- Tache CAMERA : periodique, ou tout de suite sur SW2 ---------- */
static void tache_camera(void* pv)
{
    uint32_t n          = 0;
    TickType_t echeance = xTaskGetTickCount();
    for (;;)
    {
        /* attend la prochaine echeance... ou une notification de l'interruption SW2 */
        int32_t reste   = (int32_t)(echeance - xTaskGetTickCount());
        uint32_t appuis = ulTaskNotifyTake(pdTRUE, (reste > 0) ? (TickType_t)reste : 0);
        if (appuis == 0)
            echeance += pdMS_TO_TICKS(PERIODE_CAMERA_MS); /* photo periodique */

        trame_t t;
        t.numero       = n;
        t.pixels       = images[n % NB_IMAGES];
        t.nom          = noms_images[n % NB_IMAGES];
        t.t_capture_us = Temps_us();
        t.demande      = (appuis > 0);
        n++;
        if (xQueueSend(file_images, &t, 0) != pdPASS) /* Vision est en retard : on jette la photo */
            g_images_perdues++;
    }
}

/* ---------- Tache VISION : MobileNet sur le NPU, a chaque photo recue ---------- */
static void tache_vision(void* pv)
{
    trame_t t;
    resultat_t r;
    const uint32_t taille = g_dims_entree.data[1] * g_dims_entree.data[2] * g_dims_entree.data[3]; /* 128x128x3 */
    for (;;)
    {
        xQueueReceive(file_images, &t, portMAX_DELAY); /* bloquee tant qu'il n'y a pas de photo */

        memcpy(g_entree, t.pixels, taille);                          /* photo -> tenseur d'entree */
        MODEL_ConvertInput(g_entree, &g_dims_entree, g_type_entree); /* uint8 -> int8 */
        uint32_t debut = Temps_us();
        MODEL_RunInference(); /* NeutronGraph sur le NPU + quelques operations sur le CPU */
        uint32_t duree = Temps_us() - debut;

        result_t top;
        MODEL_GetTopN(g_sortie, g_dims_sortie.data[g_dims_sortie.size - 1], g_type_sortie, 1,
                      (float)SEUIL_DETECTION / 100, &top);

        r.numero         = t.numero;
        r.nom            = t.nom;
        r.classe         = top.index;
        r.score          = (top.index >= 0) ? (int)(top.score * 100) : 0;
        r.t_inference_us = duree;
        r.latence_us     = Temps_us() - t.t_capture_us;
        r.demande        = t.demande;

        g_nb_inferences++;
        g_inf_total_us += duree;
        if (duree < g_inf_min_us)
            g_inf_min_us = duree;
        if (duree > g_inf_max_us)
            g_inf_max_us = duree;
        if (xQueueSend(file_resultats, &r, 0) != pdPASS)
            g_resultats_perdus++;
    }
}

/* ---------- Tache RADIO : envoie les resultats a la station au sol, LED ---------- */
static bool Est_une_cible(int classe)
{
    if (classe < 0)
        return false;
    for (unsigned i = 0; i < NB_CIBLES; i++)
        if (strcmp(labels[classe], CIBLES[i]) == 0)
            return true;
    return false;
}

static void tache_radio(void* pv)
{
    resultat_t r;
    for (;;)
    {
        xQueueReceive(file_resultats, &r, portMAX_DELAY);
        bool cible = Est_une_cible(r.classe);
        LED_Couleur(cible ? ROUGE : (r.classe >= 0 ? BLEU : VERT));
        LOG("[%6u ms] $VIGIE,%u,%s,%s,%d%%,inference %u us,latence %u ms%s%s\r\n", Temps_ms(), (unsigned)r.numero,
            r.nom, (r.classe >= 0) ? labels[r.classe] : "rien", r.score, (unsigned)r.t_inference_us,
            (unsigned)(r.latence_us / 1000U), r.demande ? ",SW2" : "", cible ? "  <<< CIBLE TROUVEE" : "");
    }
}

/* ---------- Tache MONITEUR ---------- */
static void tache_moniteur(void* pv)
{
    TickType_t reveil = xTaskGetTickCount();
    for (;;)
    {
        vTaskDelayUntil(&reveil, pdMS_TO_TICKS(PERIODE_MONITEUR_MS));
        Moniteur_Afficher();
        uint32_t nb = g_nb_inferences;
        LOG("Inference (us) : min %u, moy %u, max %u sur %u | photos perdues %u, resultats perdus %u\r\n",
            (unsigned)(nb ? g_inf_min_us : 0), (unsigned)(nb ? g_inf_total_us / nb : 0), (unsigned)g_inf_max_us,
            (unsigned)nb, (unsigned)g_images_perdues, (unsigned)g_resultats_perdus);
        LOG("STAB : echeances ratees %u, gigue max %u us\r\n", (unsigned)g_stab_retards,
            (unsigned)g_stab_gigue_max_us);
    }
}

static void Creer(TaskFunction_t f, const char* nom, uint32_t pile, UBaseType_t prio, TaskHandle_t* h)
{
    if (xTaskCreate(f, nom, pile, NULL, prio, h) != pdPASS)
    {
        PRINTF("Creation de la tache %s impossible : tas trop petit !" EOL, nom);
        for (;;)
            ;
    }
}

int main(void)
{
    BOARD_Init();
    TIMER_Init(); /* = Outils_Init() */
    DEMO_PrintInfo();
    LED_Init();
    BOUTON_Init();

    if (MODEL_Init() != kStatus_Success) /* avant l'ordonnanceur : prepare le modele et le NPU */
    {
        PRINTF("Failed initializing model" EOL);
        for (;;)
            ;
    }
    g_entree = MODEL_GetInputTensorData(&g_dims_entree, &g_type_entree);
    g_sortie = MODEL_GetOutputTensorData(&g_dims_sortie, &g_type_sortie);
    PRINTF("VIGIE : %d image(s), une photo toutes les %d ms, cible : %s" EOL, NB_IMAGES, PERIODE_CAMERA_MS,
           CIBLES[0]);

    Console_Init();
    file_images    = xQueueCreate(LONGUEUR_FILE_IMAGES, sizeof(trame_t));
    file_resultats = xQueueCreate(LONGUEUR_FILE_RESULTATS, sizeof(resultat_t));

    Creer(tache_stab, "Stab", PILE_STAB, PRIO_STAB, NULL);
    Creer(tache_camera, "Camera", PILE_CAMERA, PRIO_CAMERA, &h_camera);
    Creer(tache_vision, "Vision", PILE_VISION, PRIO_VISION, NULL);
    Creer(tache_radio, "Radio", PILE_RADIO, PRIO_RADIO, NULL);
    Creer(tache_moniteur, "Moniteur", PILE_MONITEUR, PRIO_MONITEUR, NULL);

    vTaskStartScheduler(); /* l'ordonnanceur prend la main : ne revient jamais */
    for (;;)
        ;
}
