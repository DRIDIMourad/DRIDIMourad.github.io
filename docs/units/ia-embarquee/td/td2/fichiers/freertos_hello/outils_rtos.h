/* outils_rtos.h (TD2) : outils de mesure et d'affichage pour FreeRTOS */
#ifndef OUTILS_RTOS_H
#define OUTILS_RTOS_H

#include <stdint.h>
#include "FreeRTOS.h"
#include "semphr.h"
#include "fsl_debug_console.h"

#if defined(__cplusplus)
extern "C" {
#endif

void     Outils_Init(void);          /* demarre le compteur de cycles du processeur */
uint32_t Temps_us(void);             /* temps ecoule depuis Outils_Init(), en microsecondes */
void     Calcul(uint32_t duree_ms);  /* occupe le processeur pendant duree_ms (attente active) */
void     Moniteur_Afficher(void);    /* affiche l'etat de toutes les taches (partie 2) */

/* Console partagee entre les taches (partie 7) */
extern SemaphoreHandle_t g_console;
void Console_Init(void);
#define LOG(...)                                                      \
    do                                                                \
    {                                                                 \
        if (g_console != NULL) xSemaphoreTake(g_console, portMAX_DELAY); \
        PRINTF(__VA_ARGS__);                                          \
        if (g_console != NULL) xSemaphoreGive(g_console);             \
    } while (0)

#if defined(__cplusplus)
}
#endif

#endif /* OUTILS_RTOS_H */
