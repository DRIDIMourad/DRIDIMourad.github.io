/* outils_rtos.c (TD2) : outils de mesure et d'affichage pour FreeRTOS */
#include "outils_rtos.h"
#include "task.h"
#include "fsl_common.h"

/* ===== Mesure du temps avec le compteur de cycles DWT->CYCCNT =====
   Le Cortex-M33 compte ses cycles d'horloge dans un registre 32 bits.
   A 150 MHz, il fait un tour complet en 2^32 / 150e6 = 28,6 s :
   on compte les tours pour obtenir un temps qui ne revient pas a zero. */
static uint32_t s_dernier = 0; /* derniere valeur lue du compteur */
static uint32_t s_tours   = 0; /* nombre de tours complets du compteur */

void Outils_Init(void)
{
    DCB->DEMCR |= DCB_DEMCR_TRCENA_Msk; /* active les blocs de trace et de mesure */
    DWT->CYCCNT = 0;                    /* remet le compteur a zero */
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk; /* lance le comptage des cycles */
    s_dernier = 0;
    s_tours   = 0;
}

uint32_t Temps_us(void)
{
    uint32_t masque     = DisableGlobalIRQ(); /* lecture atomique, utilisable partout (taches, interruptions) */
    uint32_t maintenant = DWT->CYCCNT;
    if (maintenant < s_dernier)
    {
        s_tours++; /* le compteur est repasse par zero */
    }
    s_dernier       = maintenant;
    uint64_t cycles = ((uint64_t)s_tours << 32) | maintenant;
    EnableGlobalIRQ(masque);
    return (uint32_t)(cycles / (SystemCoreClock / 1000000U)); /* 150 cycles = 1 us */
}

/* Simule un calcul : le processeur execute une boucle pendant duree_ms.
   Si la tache est preemptee, la boucle est mise en pause : la tache a toujours
   besoin de duree_ms de processeur, mais elle finit plus tard. */
void Calcul(uint32_t duree_ms)
{
    if (duree_ms > 0U)
    {
        SDK_DelayAtLeastUs(duree_ms * 1000U, SystemCoreClock);
    }
}

/* ===== Moniteur : etat de toutes les taches ===== */
#define MONITEUR_MAX_TACHES 12

void Moniteur_Afficher(void)
{
    static TaskStatus_t taches[MONITEUR_MAX_TACHES]; /* static : ne prend pas de place sur la pile */
    static const char etats[] = {'X', 'R', 'B', 'S', 'D', '?'}; /* eRunning, eReady, eBlocked, eSuspended, eDeleted, eInvalid */
    uint32_t total = 0; /* temps total d'execution (run-time stats, partie 4) */
    UBaseType_t n  = uxTaskGetSystemState(taches, MONITEUR_MAX_TACHES, &total);

    if (g_console != NULL) xSemaphoreTake(g_console, portMAX_DELAY); /* tout le tableau d'un bloc */
    PRINTF("\r\n---- Moniteur a %u ms : %u taches, tas libre %u octets (minimum %u) ----\r\n",
           (unsigned)(Temps_us() / 1000U), (unsigned)n, (unsigned)xPortGetFreeHeapSize(),
           (unsigned)xPortGetMinimumEverFreeHeapSize());
    PRINTF("Tache        Etat Prio  Pile libre (mots)  CPU\r\n");
    for (UBaseType_t i = 0; i < n; i++)
    {
        unsigned cpu = 0; /* en dixiemes de % */
#if (configGENERATE_RUN_TIME_STATS == 1)
        if (total > 0U)
        {
            cpu = (unsigned)(((uint64_t)taches[i].ulRunTimeCounter * 1000U) / total);
        }
#endif
        PRINTF("%-12s  %c   %u     %5u           %3u.%u %%\r\n", taches[i].pcTaskName,
               etats[taches[i].eCurrentState], (unsigned)taches[i].uxCurrentPriority,
               (unsigned)taches[i].usStackHighWaterMark, cpu / 10U, cpu % 10U);
    }
    if (g_console != NULL) xSemaphoreGive(g_console);
}

/* ===== Console partagee (partie 7) ===== */
SemaphoreHandle_t g_console = NULL;

void Console_Init(void)
{
    g_console = xSemaphoreCreateMutex();
}

/* ===== Crochets (hooks) appeles par FreeRTOS en cas de probleme (partie 8) ===== */
void vApplicationStackOverflowHook(TaskHandle_t tache, char *nom)
{
    PRINTF("\r\n!!! DEBORDEMENT DE PILE dans la tache %s !!!\r\n", nom);
    taskDISABLE_INTERRUPTS();
    for (;;)
    {
    }
}

void vApplicationMallocFailedHook(void)
{
    PRINTF("\r\n!!! PLUS DE MEMOIRE dans le tas FreeRTOS (configTOTAL_HEAP_SIZE) !!!\r\n");
    taskDISABLE_INTERRUPTS();
    for (;;)
    {
    }
}
