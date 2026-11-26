/* freertos_hello.c (TD2, parties 1 a 8) : le drone VIGIE sous FreeRTOS */
#include <stdbool.h>
#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"
#include "semphr.h"
#include "fsl_debug_console.h"
#include "fsl_gpio.h"
#include "pin_mux.h"
#include "clock_config.h"
#include "board.h"
#include "outils_rtos.h"

/* ===== Reglages a modifier pendant les experiences ===== */
#define PERIODE_STAB_MS     500  /* stabilisation */
#define PERIODE_NAV_MS      1000 /* navigation */
#define PERIODE_MONITEUR_MS 5000 /* moniteur (partie 2) */

#define PRIO_URGENCE  4 /* de 0 (la plus basse) a 4 (la plus haute) */
#define PRIO_MONITEUR 1
#define PRIO_STAB     3
#define PRIO_NAV      2
#define PRIO_TELEM    1

#define CALCUL_STAB_MS  0 /* durees de calcul simulees (parties 3, 4, 5) */
#define CALCUL_NAV_MS   0
#define CALCUL_TELEM_MS 0

#define NAV_DELAI_RELATIF 0 /* partie 3 : 1 = vTaskDelay, 0 = xTaskDelayUntil */
#define LONGUEUR_FILE_TELEM 4 /* partie 5 : places dans la file NAV -> TELEM */
#define AVEC_YIELD_FROM_ISR 1 /* partie 6 : 1 = portYIELD_FROM_ISR, 0 = sans */
#define BUS_PAR_MUTEX       1 /* partie 7 : 1 = mutex, 0 = semaphore binaire */
#define DEMO_INVERSION      0 /* partie 7 : 1 = scenario d'inversion de priorite */
#define TAILLE_TAMPON_TELEM 0 /* partie 8 : octets de tableau local dans TELEM */
/* ======================================================== */

#define PILE_TACHE (configMINIMAL_STACK_SIZE + 200) /* 290 mots = 1160 octets */

typedef struct
{
    uint32_t numero; /* numero de la mesure GPS */
    int32_t x_m;     /* position en metres : le drone vole sur la diagonale y = x */
    int32_t y_m;
    uint32_t t_ms;   /* instant de la mesure */
} position_t;

static TaskHandle_t h_nav, h_urgence;
static QueueHandle_t boite_position; /* partie 5 : boite aux lettres (1 place) NAV -> STAB */
static QueueHandle_t file_telem;     /* partie 5 : file NAV -> TELEM */
static SemaphoreHandle_t g_bus;      /* partie 7 : bus des capteurs partage */
static volatile position_t g_position; /* partie 5 : variable partagee SANS protection */
static volatile uint32_t g_t_appui_us; /* partie 6 : instant de l'appui sur SW2 */
static volatile uint32_t g_positions_perdues = 0;

static unsigned int Temps_ms(void)
{
    return (unsigned int)(Temps_us() / 1000U);
}

/* ---------- Partie 1 : mesurer le tick ---------- */
static void tache_mesure(void *pvParameters)
{
    const TickType_t attentes[] = {1, pdMS_TO_TICKS(3), pdMS_TO_TICKS(10)};
    for (int a = 0; a < 3; a++)
    {
        for (int i = 0; i < 3; i++)
        {
            uint32_t t0 = Temps_us();
            vTaskDelay(attentes[a]);
            uint32_t t1 = Temps_us();
            LOG("MESURE : vTaskDelay(%u tick) a dure %u us\r\n", (unsigned)attentes[a], (unsigned)(t1 - t0));
        }
    }
    vTaskDelete(NULL); /* la mesure est finie : la tache se supprime */
}

/* ---------- Tache 1 : stabilisation ---------- */
static void tache_stabilisation(void *pvParameters)
{
    int n = 0;
#if DEMO_INVERSION
    vTaskDelay(pdMS_TO_TICKS(20)); /* decalage : se reveille pendant que TELEM tient le bus */
#endif
    TickType_t reveil = xTaskGetTickCount();
    for (;;)
    {
        position_t pos;
        n++;
#if DEMO_INVERSION
        uint32_t t0 = Temps_us();
        xSemaphoreTake(g_bus, portMAX_DELAY); /* lit le gyroscope sur le bus */
        uint32_t attente = Temps_us() - t0;
        xSemaphoreGive(g_bus);
        LOG("[%6u ms] STAB  : a attendu le bus %u ms\r\n", Temps_ms(), (unsigned)(attente / 1000U));
#endif
        /* Partie 5 : lecture de la position partagee (sans protection) ... */
        int32_t x = g_position.x_m;
        int32_t y = g_position.y_m;
        if (x != y)
        {
            LOG("[%6u ms] STAB  : POSITION INCOHERENTE x=%d y=%d\r\n", Temps_ms(), (int)x, (int)y);
        }
        /* ... puis lecture de la boite aux lettres (protegee) */
        if (xQueuePeek(boite_position, &pos, 0) == pdPASS && pos.x_m != pos.y_m)
        {
            LOG("[%6u ms] STAB  : boite incoherente ?!\r\n", Temps_ms());
        }
        Calcul(CALCUL_STAB_MS);
        LOG("[%6u ms] STAB  : correction des moteurs n%d\r\n", Temps_ms(), n);
        vTaskDelayUntil(&reveil, pdMS_TO_TICKS(PERIODE_STAB_MS));
    }
}

/* ---------- Tache 2 : navigation ---------- */
static void tache_navigation(void *pvParameters)
{
    uint32_t n         = 0;
    uint32_t retards   = 0;
    uint32_t t_debut   = Temps_us();
    TickType_t reveil  = xTaskGetTickCount();
#if DEMO_INVERSION
    vTaskDelay(pdMS_TO_TICKS(40));
    reveil = xTaskGetTickCount();
#endif
    for (;;)
    {
        position_t pos;
        n++;
        /* Partie 3 : ecart entre l'instant reel et l'instant prevu n x periode */
        int32_t derive_us = (int32_t)(Temps_us() - t_debut) - (int32_t)((n - 1) * PERIODE_NAV_MS * 1000U);

        /* Partie 5 : mise a jour de la variable partagee en deux temps */
        int32_t nouvelle = (int32_t)n * 25; /* 25 m/s sur chaque axe */
        g_position.x_m   = nouvelle;
        Calcul(CALCUL_NAV_MS); /* le calcul de y prend du temps */
        g_position.y_m = nouvelle;

        /* ... et version propre : on prepare tout, puis on envoie d'un coup */
        pos.numero = n;
        pos.x_m    = nouvelle;
        pos.y_m    = nouvelle;
        pos.t_ms   = Temps_ms();
        xQueueOverwrite(boite_position, &pos);    /* boite : la derniere position remplace l'ancienne */
        if (xQueueSend(file_telem, &pos, 0) != pdPASS) /* file : on n'attend pas si elle est pleine */
        {
            g_positions_perdues++;
        }
        LOG("[%6u ms] NAV   : position GPS n%u, derive %d us, retards %u\r\n", Temps_ms(), (unsigned)n,
            (int)derive_us, (unsigned)retards);
#if NAV_DELAI_RELATIF
        (void)reveil;
        vTaskDelay(pdMS_TO_TICKS(PERIODE_NAV_MS));
#else
        if (xTaskDelayUntil(&reveil, pdMS_TO_TICKS(PERIODE_NAV_MS)) == pdFALSE)
        {
            retards++; /* l'instant du reveil etait deja passe : echeance ratee */
        }
#endif
    }
}

/* ---------- Tache 3 : telemetrie (attend les positions dans la file) ---------- */
static void tache_telemetrie(void *pvParameters)
{
#if TAILLE_TAMPON_TELEM > 0
    volatile uint8_t tampon[TAILLE_TAMPON_TELEM]; /* partie 8 : un gros tableau sur la pile */
#endif
    for (;;)
    {
#if DEMO_INVERSION
        xSemaphoreTake(g_bus, portMAX_DELAY); /* lit la batterie sur le bus... */
        LOG("[%6u ms] TELEM : prend le bus (priorite %u)\r\n", Temps_ms(), (unsigned)uxTaskPriorityGet(NULL));
        Calcul(100);                          /* ... pendant 100 ms */
        LOG("[%6u ms] TELEM : rend le bus (priorite %u)\r\n", Temps_ms(), (unsigned)uxTaskPriorityGet(NULL));
        xSemaphoreGive(g_bus);
        vTaskDelay(pdMS_TO_TICKS(2000));
#else
        position_t pos;
        xQueueReceive(file_telem, &pos, portMAX_DELAY); /* bloquee tant que la file est vide */
#if TAILLE_TAMPON_TELEM > 0
        for (int i = 0; i < TAILLE_TAMPON_TELEM; i++)
        {
            tampon[i] = (uint8_t)i; /* remplit le tableau... sur la pile ! */
        }
        (void)tampon[0];
#endif
        Calcul(CALCUL_TELEM_MS);
        LOG("[%6u ms] TELEM : envoi position n%u (%d m, %d m) mesuree a %u ms, perdues %u\r\n", Temps_ms(),
            (unsigned)pos.numero, (int)pos.x_m, (int)pos.y_m, (unsigned)pos.t_ms, (unsigned)g_positions_perdues);
#endif
    }
}

/* ---------- Partie 2 : moniteur ---------- */
static void tache_moniteur(void *pvParameters)
{
    TickType_t reveil = xTaskGetTickCount();
    for (;;)
    {
        vTaskDelayUntil(&reveil, pdMS_TO_TICKS(PERIODE_MONITEUR_MS));
        Moniteur_Afficher();
    }
}

/* ---------- Partie 6 : bouton SW2 = arret d'urgence ---------- */
static void BOUTON_Init(uint32_t pin)
{
    gpio_pin_config_t entree = {kGPIO_DigitalInput, 0};

    CLOCK_EnableClock(kCLOCK_Port0); /* le pin_mux de freertos_hello n'active que le port 1 */
    CLOCK_EnableClock(kCLOCK_Gpio0);
    /* GPIO (MUX 0) + entree numerique activee (IBE) + tirage vers le haut (PE + PS) */
    PORT0->PCR[pin] = PORT_PCR_MUX(0) | PORT_PCR_IBE_MASK | PORT_PCR_PE_MASK | PORT_PCR_PS_MASK;
    GPIO_SetPinInterruptConfig(GPIO0, pin, kGPIO_InterruptFallingEdge);
    GPIO_PinInit(GPIO0, pin, &entree);
}

void GPIO00_IRQHandler(void)
{
    uint32_t flags          = GPIO_GpioGetInterruptFlags(GPIO0);
    BaseType_t reveilFaible = pdFALSE; /* passe a pdTRUE si on reveille une tache plus prioritaire */

    GPIO_GpioClearInterruptFlags(GPIO0, flags);
    if (flags & (1U << BOARD_SW2_GPIO_PIN))
    {
        g_t_appui_us = Temps_us();
        vTaskNotifyGiveFromISR(h_urgence, &reveilFaible); /* reveille la tache Urgence */
    }
#if AVEC_YIELD_FROM_ISR
    portYIELD_FROM_ISR(reveilFaible); /* changement de tache des la sortie de l'interruption */
#endif
    SDK_ISR_EXIT_BARRIER;
}

static void tache_urgence(void *pvParameters)
{
    for (;;)
    {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY); /* bloquee jusqu'a un appui */
        uint32_t latence = Temps_us() - g_t_appui_us;
        LOG("[%6u ms] URGENCE : retour a la base ! (latence %u us)\r\n", Temps_ms(), (unsigned)latence);
        vTaskDelay(pdMS_TO_TICKS(300)); /* anti-rebond : on ignore les rebonds... */
        ulTaskNotifyTake(pdTRUE, 0);    /* ... et on efface ceux arrives pendant ce temps */
    }
}

static void Creer(TaskFunction_t f, const char *nom, uint32_t pile, UBaseType_t prio, TaskHandle_t *h)
{
    if (xTaskCreate(f, nom, pile, NULL, prio, h) != pdPASS)
    {
        PRINTF("Creation de la tache %s impossible : tas trop petit !\r\n", nom);
    }
}

int main(void)
{
    /* attach FRO 12M to FLEXCOMM4 (debug console) */
    CLOCK_SetClkDiv(kCLOCK_DivFlexcom4Clk, 1u);
    CLOCK_AttachClk(BOARD_DEBUG_UART_CLK_ATTACH);
    BOARD_InitPins();
    BOARD_InitBootClocks();
    BOARD_InitDebugConsole();
    Outils_Init();

    PRINTF("\r\nTD2 - drone VIGIE sous FreeRTOS (tick %u Hz)\r\n", (unsigned)configTICK_RATE_HZ);

    Console_Init(); /* LOG protege la console par un mutex (explications en partie 7) */
    boite_position = xQueueCreate(1, sizeof(position_t));
    file_telem     = xQueueCreate(LONGUEUR_FILE_TELEM, sizeof(position_t));
#if BUS_PAR_MUTEX
    g_bus = xSemaphoreCreateMutex();
#else
    g_bus = xSemaphoreCreateBinary();
    xSemaphoreGive(g_bus); /* un semaphore binaire est cree "vide" : on le rend disponible */
#endif

    BOUTON_Init(BOARD_SW2_GPIO_PIN);
    NVIC_SetPriority(BOARD_SW2_IRQ, 3); /* >= configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY (2) */
    EnableIRQ(BOARD_SW2_IRQ);

    Creer(tache_mesure, "Mesure", PILE_TACHE, 4, NULL);
    Creer(tache_stabilisation, "Stab", PILE_TACHE, PRIO_STAB, NULL);
    Creer(tache_navigation, "Nav", PILE_TACHE, PRIO_NAV, &h_nav);
    Creer(tache_telemetrie, "Telem", PILE_TACHE, PRIO_TELEM, NULL);
    Creer(tache_moniteur, "Moniteur", PILE_TACHE, PRIO_MONITEUR, NULL);
    Creer(tache_urgence, "Urgence", PILE_TACHE, PRIO_URGENCE, &h_urgence);

    vTaskStartScheduler(); /* l'ordonnanceur prend la main : ne revient jamais */
    for (;;)
        ;
}
