# TD2 : FreeRTOS en profondeur — le drone VIGIE, de l'ordonnanceur au réseau de neurones sur le NPU


## Objectifs, prérequis et déroulé

Au TD1, on a créé trois tâches FreeRTOS et observé qu'elles s'exécutent « en même temps ». Dans ce TD, on ouvre le capot : **comment** FreeRTOS décide qui s'exécute, **ce qui se passe** à chaque tick, comment on **mesure** le temps et la charge du processeur, comment les tâches **communiquent** et **partagent** une ressource sans se marcher dessus, et où vit leur **mémoire**. À la fin, on assemble tout dans un vrai système temps réel : le drone **VIGIE** prend des photos à intervalle régulier et les reconnaît avec un réseau **MobileNet** exécuté sur le **NPU** du MCX N947, pendant que sa stabilisation continue de tourner à l'heure, 100 fois par seconde.

Comme au TD1, on ne part jamais d'une page blanche : chaque partie **enrichit le programme de la partie précédente**. Chaque question a sa réponse, à déplier **après** avoir cherché. La dernière partie (feu tricolore) est un **travail noté**.

!!! tip "Comment travailler"
    Pour chaque partie : lire, taper (ou copier) le code, **compiler et essayer sur la carte**, noter ce qu'on observe, puis répondre aux questions **avant** d'ouvrir les réponses. Les sorties du terminal données dans le sujet sont **indicatives** : vos nombres seront un peu différents, c'est normal, et c'est justement ce qu'on veut comprendre.

!!! warning "État du code"
    Tout le code de ce TD a été **compilé et lié** avec les sources du **SDK FRDM-MCXN947 2.14.0** (FreeRTOS 10.5.1, TensorFlow Lite Micro et bibliothèques Neutron du SDK, compilateur `arm-none-eabi-gcc`), sans erreur ni avertissement. Il n'a **pas encore été exécuté sur la carte** : les sorties du terminal sont des prévisions, à confirmer en séance.

| Partie | Ce qu'on découvre | Ce qu'on ajoute au drone |
| --- | --- | --- |
| 0 | Le scénario, le point de départ | Le projet du TD1 |
| 1 | Le **tick**, le changement de contexte, la pile de chaque tâche | Des outils de mesure (`outils_rtos.c`), un tick à 1 kHz |
| 2 | Les **états** d'une tâche, la tâche Idle | Une tâche **Moniteur** |
| 3 | `vTaskDelay` ou `xTaskDelayUntil` : **dérive**, **gigue**, **échéances ratées**, partage du temps | Une navigation mesurée |
| 4 | La **charge** du processeur, la règle de Liu et Layland | Les statistiques d'exécution |
| 5 | Les **files de messages** et la boîte aux lettres | Positions GPS envoyées sans risque |
| 6 | **Interruption** → tâche : notification, sémaphore, `portYIELD_FROM_ISR` | Bouton SW2 = arrêt d'urgence |
| 7 | Le **mutex**, l'**inversion de priorité** | Console et bus capteurs partagés |
| 8 | La **pile** et le **tas** : débordements | Les crochets de sécurité |
| 9 | Synthèse : des tâches périodiques et **MobileNet sur le NPU** | VIGIE voit et reconnaît |
| 10 — **noté** | Réutiliser seul tout ce qui précède | Feu tricolore avec bouton piéton. **À rendre** |

**Matériel :** carte NXP FRDM-MCXN947, câble USB-C sur le connecteur **MCU-Link (J17)**.

**Logiciel :** MCUXpresso IDE, **SDK FRDM-MCXN947 2.14.0** avec **FreeRTOS** et **eIQ** (cochés dans le SDK Builder), terminal série **115200 bauds, 8N1**. Pour la partie 9 (facultatif) : Python avec `opencv-python`, comme au TP3.

**Fichiers à télécharger** (les mêmes que dans le sujet) : parties 1 à 8 : [`outils_rtos.h`](fichiers/freertos_hello/outils_rtos.h), [`outils_rtos.c`](fichiers/freertos_hello/outils_rtos.c), [`freertos_hello.c`](fichiers/freertos_hello/freertos_hello.c) (version finale), [`FreeRTOSConfig.h`](fichiers/freertos_hello/FreeRTOSConfig.h) ; partie 9 : [`main.cpp`](fichiers/vigie/main.cpp), [`timer.c`](fichiers/vigie/timer.c), [`FreeRTOSConfig.h`](fichiers/vigie/FreeRTOSConfig.h).

**Prérequis :** le TD1 (LED RGB, boutons, interruptions, tâches FreeRTOS) et le TP1 (exemple `tflm_label_image`, NPU).

**Durée :** environ 2 séances de 3 h : parties 0 à 5 dans la première, parties 6 à 9 dans la seconde. La partie 10 est terminée en autonomie et rendue à la date fixée par l'enseignant.

## Partie 0 — Le scénario : le drone VIGIE

VIGIE est un petit drone de surveillance. Son logiciel embarqué fait plusieurs choses à la fois, chacune avec son **rythme** et son **urgence** :

| Tâche | Rôle | Rythme | Urgence |
| --- | --- | --- | --- |
| STAB | Stabilisation : lit les capteurs, corrige les moteurs. Un retard et le drone tombe. | Périodique | Maximale |
| NAV | Navigation : position GPS | Périodique | Moyenne |
| TELEM | Télémétrie : envoie l'état à la station au sol | À chaque nouvelle position | Faible |
| URGENCE | Arrêt d'urgence demandé par l'opérateur (bouton SW2) | Sur événement | Maximale |
| CAMERA, VISION, RADIO | Prendre une photo, la reconnaître avec MobileNet sur le NPU, envoyer le résultat (partie 9) | Périodique et sur événement | Moyenne à faible |
| MONITEUR | Affiche l'état de toutes les tâches | Toutes les 5 s | Faible |

À la fin de la partie 9, l'architecture du drone sera celle-ci :

```
  SysTick (1 kHz) ──► ordonnanceur FreeRTOS : la tache prete la plus prioritaire s'execute

  [STAB  p4]  toutes les 10 ms, 1 ms de calcul
  SW2 ──interruption──► notification ──┐
  [CAMERA p3] toutes les 500 ms ◄──────┘  (ou tout de suite sur SW2)
        │ file "images" (2 places)
        ▼
  [VISION p2] MobileNet sur le NPU (~12 ms)
        │ file "resultats" (4 places)
        ▼
  [RADIO  p1] terminal $VIGIE,... + LED      [MONITEUR p1] toutes les 5 s
        └──────── mutex "console" ─────────────┘
```

**0.1 Point de départ**

On repart du projet de la **partie 4 du TD1** (`TD1_freertos_hello`, les trois tâches STAB, NAV, TELEM). Pour garder le TD1 intact :

1. **Import SDK example(s)** → **rtos\_examples** (ou **freertos\_examples**) → **freertos\_hello**, préfixe `TD2_`.
2. **Build**, **Debug**, **Resume** : `Hello world.` s'affiche une fois. Le projet fonctionne.
3. On remplacera le contenu de `source/freertos_hello.c` à la partie 1.

!!! abstract "À retenir"
    Un système temps réel n'est pas un système « rapide » : c'est un système qui fait chaque chose **à l'heure**. Toute la suite consiste à vérifier, par des **mesures**, que chaque tâche respecte son rythme.

## Partie 1 — Le tick : l'horloge de FreeRTOS

**1.1 Des outils pour mesurer le temps**

Au TD1, le temps était donné par `xTaskGetTickCount()` : précision d'un tick (5 ms). Pour voir ce qui se passe **à l'intérieur** d'un tick, il faut une horloge bien plus fine. Le cœur Cortex-M33 en a une : le registre **`DWT->CYCCNT`** compte les **cycles** du processeur (150 millions par seconde à 150 MHz). On l'emballe dans un petit fichier d'outils qui servira dans tout le TD.

Dans le dossier `source` du projet : clic droit → **New** → **Header File** `outils_rtos.h`, puis **New** → **Source File** `outils_rtos.c`, et y copier :

??? note "Fichier `outils_rtos.h` (à copier)"

    ```c
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
    ```

??? note "Fichier `outils_rtos.c` (à copier)"

    ```c
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
    ```

Ce qu'il y a dans ce fichier (le reste servira plus tard, on y reviendra) :

- `Outils_Init()` lance le compteur de cycles. `Temps_us()` le lit et le convertit en **microsecondes**. Le compteur fait 32 bits : à 150 MHz, il revient à zéro toutes les **28,6 s**. `Temps_us()` compte ses tours pour donner un temps qui ne revient pas à zéro ; il faut donc l'appeler au moins une fois toutes les 28 s (c'est toujours le cas dans ce TD).
- `Temps_us()` coupe les interruptions le temps de trois lignes (`DisableGlobalIRQ`) : sinon une interruption pourrait l'appeler **au milieu** de la mise à jour de `s_tours`. On reverra ce problème en partie 5.
- `Calcul(duree_ms)` simule un calcul long, comme au TD1 : le processeur exécute une boucle et ne rend **jamais** la main de lui-même.
- `LOG(...)` s'utilise exactement comme `PRINTF`, mais une seule tâche à la fois peut écrire : la console est protégée par un **mutex**, créé par `Console_Init()` dans `main()`. On utilise `LOG` dès maintenant ; on verra en partie 7 ce qui se passe sans.
- `Moniteur_Afficher()` et les deux fonctions `vApplication...Hook` serviront aux parties 2 et 8.

**1.2 Le programme de départ**

Remplacer **tout le contenu** de `source/freertos_hello.c` par le programme ci-dessous. C'est le drone du TD1, avec trois changements : l'heure vient de `Temps_us()`, l'affichage passe par `LOG` (et `Console_Init()` dans `main()`), et une tâche **Mesure** chronomètre `vTaskDelay` puis se supprime.

??? note "Fichier `freertos_hello.c` de la partie 1 (à copier)"

    ```c
    /* freertos_hello.c (TD2, partie 1) : le drone VIGIE sous FreeRTOS */
    #include "FreeRTOS.h"
    #include "task.h"
    #include "fsl_debug_console.h"
    #include "pin_mux.h"
    #include "clock_config.h"
    #include "board.h"
    #include "outils_rtos.h"

    /* ===== Reglages a modifier pendant les experiences ===== */
    #define PERIODE_STAB_MS   500  /* stabilisation */
    #define PERIODE_NAV_MS    1000 /* navigation */
    #define PERIODE_TELEM_MS  2000 /* telemetrie */

    #define PRIO_STAB  3 /* de 0 (la plus basse) a 4 (la plus haute) */
    #define PRIO_NAV   2
    #define PRIO_TELEM 1

    #define CALCUL_TELEM_MS 0 /* duree du calcul de la telemetrie */
    /* ======================================================== */

    #define PILE_TACHE (configMINIMAL_STACK_SIZE + 200) /* 290 mots = 1160 octets */

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
        TickType_t reveil = xTaskGetTickCount();
        for (;;)
        {
            n++;
            LOG("[%6u ms] STAB  : correction des moteurs n%d\r\n", Temps_ms(), n);
            vTaskDelayUntil(&reveil, pdMS_TO_TICKS(PERIODE_STAB_MS));
        }
    }

    /* ---------- Tache 2 : navigation ---------- */
    static void tache_navigation(void *pvParameters)
    {
        int n = 0;
        TickType_t reveil = xTaskGetTickCount();
        for (;;)
        {
            n++;
            LOG("[%6u ms] NAV   : position GPS n%d\r\n", Temps_ms(), n);
            vTaskDelayUntil(&reveil, pdMS_TO_TICKS(PERIODE_NAV_MS));
        }
    }

    /* ---------- Tache 3 : telemetrie ---------- */
    static void tache_telemetrie(void *pvParameters)
    {
        int n = 0;
        TickType_t reveil = xTaskGetTickCount();
        for (;;)
        {
            n++;
            LOG("[%6u ms] TELEM : debut envoi n%d\r\n", Temps_ms(), n);
            Calcul(CALCUL_TELEM_MS);
            LOG("[%6u ms] TELEM : fin envoi n%d\r\n", Temps_ms(), n);
            vTaskDelayUntil(&reveil, pdMS_TO_TICKS(PERIODE_TELEM_MS));
        }
    }

    /* Cree une tache et previent si la memoire manque */
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
        Outils_Init(); /* demarre la mesure du temps */

        PRINTF("\r\nTD2 - drone VIGIE sous FreeRTOS (tick %u Hz)\r\n", (unsigned)configTICK_RATE_HZ);
        Console_Init(); /* LOG protege la console par un mutex (explications en partie 7) */

        Creer(tache_mesure, "Mesure", PILE_TACHE, 4, NULL);
        Creer(tache_stabilisation, "Stab", PILE_TACHE, PRIO_STAB, NULL);
        Creer(tache_navigation, "Nav", PILE_TACHE, PRIO_NAV, NULL);
        Creer(tache_telemetrie, "Telem", PILE_TACHE, PRIO_TELEM, NULL);

        vTaskStartScheduler(); /* l'ordonnanceur prend la main : ne revient jamais */
        for (;;)
            ;
    }
    ```

La tâche Mesure, la plus prioritaire, chronomètre trois attentes, trois fois chacune : `vTaskDelay(1)` (un tick), `vTaskDelay(pdMS_TO_TICKS(3))` (3 ms) et `vTaskDelay(pdMS_TO_TICKS(10))` (10 ms). Puis elle se supprime elle-même avec `vTaskDelete(NULL)`.

**Checkpoint :** **Build**, **Debug**, **Resume**. Le terminal affiche les 9 lignes `MESURE`, puis les tâches du drone comme au TD1.

**Questions**

1. `configTICK_RATE_HZ` vaut 200 (TD1). Combien vaut `pdMS_TO_TICKS(3)` ? Et `pdMS_TO_TICKS(10)` ? Le terminal affiche ces valeurs entre parenthèses : vérifiez.
2. Combien de temps a réellement duré `vTaskDelay(1)` ? Pourquoi la première mesure est-elle plus longue que les deux suivantes ?
3. Que se passe-t-il avec `vTaskDelay(pdMS_TO_TICKS(3))` ? Est-ce grave ?
4. Combien dure un `vTaskDelay(pdMS_TO_TICKS(10))` ? Énoncez une règle : `vTaskDelay(n)` attend entre … et … ticks.

??? success "Réponses (1.2)"
    1. `pdMS_TO_TICKS(ms)` calcule `ms × configTICK_RATE_HZ / 1000` **en nombres entiers** : 3 × 200 / 1000 = 0,6 → **0 tick**. 10 × 200 / 1000 = **2 ticks**.
    2. Le tick a lieu toutes les **5 ms**. `vTaskDelay(1)` ne veut pas dire « attendre 5 ms » mais « attendre **le prochain tick** » : si on l'appelle juste après un tick, on attend presque 5 ms (≈ 4 900 µs) ; si on l'appelle 3,5 ms après, on n'attend plus que 1,5 ms. Après la première mesure, la tâche passe environ 3 à 4 ms à **afficher** sa ligne (la liaison série est lente, voir partie 7) avant de rappeler `vTaskDelay(1)` : il ne reste qu'un morceau de tick à attendre.
    3. `vTaskDelay(0)` n'attend **pas du tout** : la tâche rend juste la main (quelques microsecondes). Si on voulait vraiment 3 ms, c'est un **bug silencieux** : le programme compile, mais la tâche tourne en boucle sans jamais dormir et peut affamer les tâches moins prioritaires.
    4. Entre 5 et 10 ms (environ 6,5 ms ici, à cause du temps d'affichage). Règle : **`vTaskDelay(n)` attend entre n − 1 et n ticks** (plus le temps d'attendre son tour si une tâche plus prioritaire s'exécute).

**1.3 Sous le capot : que se passe-t-il à chaque tick ?**

Le **SysTick** est un petit compteur intégré au Cortex-M33. FreeRTOS le programme pour qu'il déclenche une **interruption** `configTICK_RATE_HZ` fois par seconde. À chaque interruption (`SysTick_Handler`, dans le fichier `port.c` de FreeRTOS) :

1. le compteur de ticks avance de 1 (`xTaskGetTickCount()` le renvoie) ;
2. FreeRTOS regarde dans sa liste des tâches **bloquées** celles dont l'heure de réveil est arrivée, et les met dans la liste des tâches **prêtes** ;
3. si une tâche prête est **plus prioritaire** que celle qui s'exécute, il demande un **changement de contexte** : il déclenche l'interruption **PendSV**, la moins prioritaire du système, qui s'exécutera juste après.

Le changement de contexte (`PendSV_Handler`, fichier `portasm.c`) fait passer le processeur d'une tâche à une autre :

```
Tache A en cours                                            Tache B reprend
   |  interruption                                               ^
   v                                                             |
 le materiel empile sur la pile de A :      PendSV_Handler :
 R0-R3, R12, LR, PC, xPSR (8 mots)    -->   1. empile R4-R11, LR, PSPLIM sur la pile de A (10 mots)
                                            2. range le sommet de pile dans le TCB de A
                                            3. vTaskSwitchContext() : choisit la tache prete
                                               la plus prioritaire -> B (pxCurrentTCB = TCB de B)
                                            4. relit le sommet de pile dans le TCB de B
                                            5. depile R4-R11, LR, PSPLIM de B ; le materiel
                                               depile R0-R3, R12, LR, PC, xPSR : B reprend
                                               exactement la ou elle s'etait arretee
```

- Chaque tâche a **sa propre pile** (la taille donnée à `xTaskCreate`). Quand une tâche ne s'exécute pas, **tout son état** (ses registres, ses variables locales, l'endroit où elle s'était arrêtée) est rangé sur sa pile.
- Le **TCB** (*Task Control Block*) est la fiche d'identité de la tâche : son nom, sa priorité, son état, et l'adresse du sommet de sa pile. `pxCurrentTCB` pointe toujours sur le TCB de la tâche en cours.
- Si la tâche utilise des nombres à virgule (FPU), 16 + 16 registres flottants sont sauvegardés en plus.
- **PSPLIM** est la limite basse de la pile de la tâche : si la pile descend en dessous, le Cortex-M33 déclenche une **faute matérielle** (partie 8).

**1.4 Un tick plus rapide**

Ouvrir `source/FreeRTOSConfig.h` et remplacer :

```c
#define configTICK_RATE_HZ                      ((TickType_t)200)
```

par :

```c
#define configTICK_RATE_HZ                      ((TickType_t)1000) /* TD2 partie 1 : 200 -> 1000 */
```

**Checkpoint :** recompiler, relancer. La première ligne affiche maintenant `tick 1000 Hz`. Relever les 9 mesures.

**Questions**

1. Que valent maintenant `pdMS_TO_TICKS(3)` et `pdMS_TO_TICKS(10)` ? Les attentes sont-elles plus justes ?
2. L'interruption SysTick dure quelques microsecondes. Supposons 3 µs : quelle part du temps processeur coûte le tick à 200 Hz ? À 1000 Hz ? Pourquoi ne pas monter à 100 kHz ?
3. Les instants affichés par STAB et NAV sont-ils toujours multiples de 500 ms et 1000 ms ? D'où viennent les petits décalages ?

??? success "Réponses (1.4)"
    1. **3 ticks** et **10 ticks** de 1 ms. `vTaskDelay(pdMS_TO_TICKS(3))` attend maintenant entre 2 et 3 ms au lieu de 0 : la résolution est 5 fois meilleure.
    2. 200 × 3 µs = 0,6 ms par seconde = **0,06 %** ; 1000 × 3 µs = **0,3 %**. À 100 kHz, ce serait 300 ms par seconde = **30 %** du processeur juste pour compter le temps : le tick a un **coût**, on choisit le plus lent qui donne la précision nécessaire. 1 kHz est le réglage le plus courant ; on le garde pour la suite du TD.
    3. Pas exactement : quand plusieurs tâches se réveillent au même tick, elles passent l'une après l'autre (par priorité), et chaque affichage prend quelques millisecondes. La tâche la moins prioritaire du lot s'affiche donc un peu plus tard. Ce retard au réveil s'appelle la **gigue** (partie 3).

!!! abstract "À retenir"
    Le **tick** est une interruption périodique (SysTick) : c'est l'horloge de FreeRTOS, toutes les durées sont des nombres **entiers** de ticks (`pdMS_TO_TICKS` arrondit vers le bas : attention à 0 !). `vTaskDelay(n)` attend entre n − 1 et n ticks. Le **changement de contexte** sauvegarde les registres de la tâche sur **sa** pile et range le sommet de pile dans son **TCB**. Un tick plus rapide est plus précis mais coûte plus de processeur.

## Partie 2 — Les états des tâches, en direct

Au TD1, on a vu trois états sur le papier : en cours, prête, bloquée. On va maintenant les **voir** dans le terminal, grâce à une tâche **Moniteur** qui photographie toutes les tâches toutes les 5 secondes.

**2.1 Comment le moniteur fonctionne**

`Moniteur_Afficher()` (dans `outils_rtos.c`) appelle `uxTaskGetSystemState()` : FreeRTOS remplit un tableau `TaskStatus_t` avec, pour chaque tâche, son nom, son état, sa priorité et la **place restante** sur sa pile au pire moment depuis son démarrage (`usStackHighWaterMark`, en mots de 4 octets). Cette fonction existe parce que `configUSE_TRACE_FACILITY` vaut 1 dans `FreeRTOSConfig.h`.

Les états sont codés par une lettre :

| Lettre | État FreeRTOS | Signification |
| --- | --- | --- |
| `X` | `eRunning` | En cours : utilise le processeur (une seule tâche à la fois) |
| `R` | `eReady` | Prête : voudrait s'exécuter, une tâche plus prioritaire a le processeur |
| `B` | `eBlocked` | Bloquée : attend un délai (`vTaskDelay`…) ou un événement (file, sémaphore, notification), **avec ou sans** limite de temps |
| `S` | `eSuspended` | Suspendue par `vTaskSuspend` : ne sera plus jamais choisie, jusqu'à `vTaskResume` |
| `D` | `eDeleted` | Supprimée, mais sa mémoire n'a pas encore été rendue |

```
                vTaskResume()
   Suspendue S <──────────────── (n'importe quel etat) ──vTaskSuspend()──► S

            creation                ordonnanceur : la plus prioritaire
   xTaskCreate ──► Prete R  ──────────────────────────────────► En cours X
                     ^  ^     <─── preemptee (plus prioritaire prete) ──┘ │
                     │  └── delai ecoule / evenement arrive ──┐          │ vTaskDelay, attente
                     │                                         Bloquee B ◄┘ d'une file, d'un
                     │                                                      semaphore...
```

**2.2 Ajouter la tâche Moniteur**

1. Dans `FreeRTOSConfig.h`, agrandir le **tas** de FreeRTOS (la mémoire où sont créées les tâches, partie 8) : remplacer `(10 * 1024)` par `(20 * 1024)` dans la ligne `configTOTAL_HEAP_SIZE`.
2. Dans `freertos_hello.c`, ajouter dans le bloc des réglages :

```c
#define PERIODE_MONITEUR_MS 5000 /* moniteur (partie 2) */
#define PRIO_MONITEUR 1
```

3. Ajouter la tâche, avant `main()` :

```c
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
```

4. Dans `main()`, après les autres `Creer(...)` :

```c
    Creer(tache_moniteur, "Moniteur", PILE_TACHE, PRIO_MONITEUR, NULL);
```

**Checkpoint :** toutes les 5 s, un tableau s'affiche, par exemple (valeurs indicatives) :

```
---- Moniteur a 5004 ms : 6 taches, tas libre 11032 octets (minimum 10872) ----
Tache        Etat Prio  Pile libre (mots)  CPU
Moniteur      X   1       176             0.0 %
Telem         R   1       201             0.0 %
IDLE          R   0        60             0.0 %
Stab          B   3       205             0.0 %
Nav           B   2       205             0.0 %
Tmr Svc       B   4       160             0.0 %
```

(La colonne CPU reste à 0 jusqu'à la partie 4.)

**Questions**

1. La tâche **Mesure** de la partie 1 n'apparaît plus. Pourquoi ? Qui a rendu sa mémoire ?
2. Deux tâches que vous n'avez pas créées apparaissent : **IDLE** et **Tmr Svc**. Que font-elles ? Pourquoi IDLE a-t-elle la priorité 0 ?
3. Pourquoi le Moniteur est-il toujours dans l'état `X` ? Pourquoi STAB et NAV sont-elles presque toujours `B` ?
4. Pourquoi a-t-on donné au Moniteur la priorité **la plus basse** ? Que se passerait-il s'il avait la priorité 4 ?
5. **Expérience.** Dans `tache_telemetrie`, juste après `n++;`, ajouter :

    ```c
            if (n == 2) vTaskSuspend(h_nav);  /* la telemetrie met la navigation en pause */
            if (n == 5) vTaskResume(h_nav);   /* ... puis la relance */
    ```

    avec `static TaskHandle_t h_nav;` en haut du fichier, et `&h_nav` comme dernier argument du `Creer` de la navigation. Que montrent le terminal et le moniteur entre 2 s et 8 s ? Que fait NAV quand elle repart ? (Retirer ces deux lignes après l'expérience.)

??? success "Réponses (2.2)"
    1. Elle a appelé `vTaskDelete(NULL)` : elle est passée dans l'état **D**, puis la tâche **IDLE** a rendu au tas sa pile et son TCB. Comparez le « tas libre » et le « minimum » : le minimum a été atteint quand Mesure existait encore.
    2. **IDLE** est créée par `vTaskStartScheduler()` : elle s'exécute quand **aucune autre** tâche n'est prête (c'est pour cela qu'elle a la priorité la plus basse, 0) et libère la mémoire des tâches supprimées. Le processeur ne s'arrête jamais : « ne rien faire », c'est exécuter IDLE. **Tmr Svc** est la tâche des **timers logiciels** (`configUSE_TIMERS` = 1) ; on ne s'en sert pas, elle reste bloquée.
    3. Le Moniteur est la tâche qui **appelle** `uxTaskGetSystemState()` : au moment de la photo, c'est forcément lui qui a le processeur. STAB et NAV ne travaillent que quelques millisecondes par période et **dorment** le reste du temps (`vTaskDelayUntil`) : on les trouve presque toujours bloquées. TELEM, de même priorité que le Moniteur, peut être `R` (prête, elle attend que le Moniteur finisse) ou `B`.
    4. Afficher le tableau prend plusieurs dizaines de millisecondes (une dizaine de lignes sur une liaison série lente). Avec la priorité 4, le Moniteur **retarderait** STAB et NAV pendant ce temps : l'outil d'observation perturberait le système observé. Un moniteur doit être **discret** : priorité basse.
    5. Les lignes `NAV` disparaissent ; le moniteur affiche NAV dans l'état `S`. Une tâche suspendue n'est plus jamais choisie, même si son délai est écoulé. À la reprise, `vTaskDelayUntil` voit que plusieurs réveils sont déjà passés : NAV s'exécute plusieurs fois **de suite**, sans attendre, pour « rattraper » les périodes manquées, puis retrouve son rythme.

!!! abstract "À retenir"
    Une tâche est toujours dans un des états **X** (en cours), **R** (prête), **B** (bloquée sur un délai ou un événement), **S** (suspendue), **D** (supprimée). Une seule tâche est `X` à la fois. Quand personne n'a de travail, c'est la tâche **IDLE** (priorité 0) qui s'exécute. `uxTaskGetSystemState()` donne une photo de toutes les tâches : un outil indispensable pour comprendre un système multitâche.

## Partie 3 — Le temps : dérive, gigue et échéances

Une tâche périodique doit se réveiller à des instants **réguliers** : 0, 1000, 2000 ms… On va mesurer, avec la précision de la microseconde, à quel point c'est vrai.

**3.1 La navigation mesure son propre retard**

Ajouter dans le bloc des réglages :

```c
#define CALCUL_NAV_MS   0
#define NAV_DELAI_RELATIF 0 /* partie 3 : 1 = vTaskDelay, 0 = xTaskDelayUntil */
```

et remplacer `tache_navigation` par :

```c
/* ---------- Tache 2 : navigation ---------- */
static void tache_navigation(void *pvParameters)
{
    uint32_t n         = 0;
    uint32_t retards   = 0;
    uint32_t t_debut   = Temps_us();
    TickType_t reveil  = xTaskGetTickCount();
    for (;;)
    {
        n++;
        /* Partie 3 : ecart entre l'instant reel et l'instant prevu n x periode */
        int32_t derive_us = (int32_t)(Temps_us() - t_debut) - (int32_t)((n - 1) * PERIODE_NAV_MS * 1000U);

        Calcul(CALCUL_NAV_MS); /* le calcul de la position prend du temps */

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
```

- `derive_us` est l'écart entre l'instant où la n-ième exécution **commence vraiment** et l'instant **prévu** `(n − 1) × période`.
- `xTaskDelayUntil` (le nouveau nom de `vTaskDelayUntil` depuis FreeRTOS 10.4, le TD1 utilisait l'ancien) renvoie `pdFALSE` quand l'instant de réveil demandé est **déjà passé** : la tâche a **raté son échéance**, elle repart tout de suite. On compte ces retards.

**3.2 Expériences**

Pour chaque expérience : modifier les `#define`, recompiler, observer 10 lignes NAV, puis remettre les valeurs d'origine.

| N° | Modifier | Observer |
| --- | --- | --- |
| T1 | Rien | Comment évolue `derive` ? |
| T2 | `CALCUL_NAV_MS 30` | Et maintenant ? |
| T3 | `CALCUL_NAV_MS 30`, `NAV_DELAI_RELATIF 1` | Comment évolue `derive` ? Que vaut-elle après 10 positions ? |
| T4 | `CALCUL_NAV_MS 1200` | Que deviennent `derive` et `retards` ? |
| T5 | `PERIODE_STAB_MS 100` et dans `tache_stabilisation`, `Calcul(40);` juste avant le `LOG` | Comment évolue `derive` de NAV ? D'où vient la différence avec T1 ? |

??? success "Réponses (3.2)"
    - **T1.** `derive` reste petite (de l'ordre de quelques millisecondes) et **ne grandit pas** : à chaque réveil commun avec STAB, NAV attend que STAB (plus prioritaire) ait fini son affichage. Ce retard au réveil, variable mais **borné**, s'appelle la **gigue** (*jitter*).
    - **T2.** Pareil : `xTaskDelayUntil` calcule le réveil suivant à partir du réveil **précédent** (`reveil + période`), pas à partir de « maintenant ». Les 30 ms de calcul sont **absorbées** : la période reste exactement 1000 ms.
    - **T3.** `derive` augmente de 30 ms environ (plus le temps d'affichage) **à chaque période** : environ 300 ms après 10 positions, et ça ne s'arrête jamais. `vTaskDelay(1000)` attend 1000 ms **à partir de maintenant**, c'est-à-dire après le calcul : la vraie période est 1030 ms et les retards s'**additionnent**. C'est la **dérive**. Pour une tâche périodique, toujours `xTaskDelayUntil`.
    - **T4.** Le calcul (1200 ms) dure plus que la période (1000 ms) : chaque réveil est déjà passé, `xTaskDelayUntil` renvoie `pdFALSE`, `retards` augmente à chaque tour et `derive` grandit de 200 ms par période. La tâche est en **surcharge** : aucun réglage de FreeRTOS ne peut la sauver, il faut un calcul plus court ou une période plus longue.
    - **T5.** STAB, plus prioritaire, occupe le processeur 40 ms toutes les 100 ms. Quand NAV doit se réveiller pendant un calcul de STAB, elle attend qu'il finisse : sa gigue peut atteindre **40 ms** (plus les affichages). Elle ne dérive pas pour autant (`xTaskDelayUntil`). La gigue d'une tâche dépend du travail des tâches **plus prioritaires**.

**3.3 Deux tâches de même priorité : le partage du temps**

Que se passe-t-il si deux tâches **prêtes** ont la **même** priorité ? Cela dépend de `configUSE_TIME_SLICING`.

1. Mettre `PRIO_NAV 1` (comme TELEM), `CALCUL_NAV_MS 300` et `CALCUL_TELEM_MS 300`. À 0 et 2000 ms, NAV et TELEM se réveillent ensemble, à égalité.
2. Observer l'ordre des lignes `NAV`, `TELEM : debut` et `TELEM : fin` à 2000 ms.
3. Dans `FreeRTOSConfig.h`, passer `configUSE_TIME_SLICING` de **0** à **1**, recompiler et comparer.
4. Remettre `configUSE_TIME_SLICING 0`, `PRIO_NAV 2` et les calculs à 0.

??? success "Réponses (3.3)"
    - Avec `configUSE_TIME_SLICING 0` (réglage du SDK NXP) : la première des deux tâches à démarrer garde le processeur pendant **tout** son calcul de 300 ms, et l'autre ne **commence** qu'ensuite. Par exemple, si NAV passe la première : `NAV` vers 2300 ms, puis `TELEM : debut` vers 2300 ms et `TELEM : fin` vers 2600 ms. Une tâche n'est préemptée que par une tâche **plus** prioritaire.
    - Avec `configUSE_TIME_SLICING 1` : à **chaque tick**, l'ordonnanceur passe à l'autre tâche de même priorité (*round robin*, ici toutes les 1 ms). Les deux calculs avancent en parallèle et finissent **tous les deux** vers 600 ms : `TELEM : debut` s'affiche tôt, NAV et `TELEM : fin` vers la fin.
    - Aucune des deux façons n'est « meilleure » : sans partage, la première tâche finit plus tôt ; avec partage, aucune n'attend longtemps pour **commencer**. Dans un système temps réel, on évite en général de compter dessus : on donne des priorités **différentes**.

!!! abstract "À retenir"
    **Dérive** : les retards s'additionnent d'une période à l'autre (`vTaskDelay` dans une tâche périodique). **Gigue** : retard au réveil, variable mais borné, causé par les tâches plus prioritaires. **Échéance ratée** : la tâche n'a pas fini avant sa période suivante (`xTaskDelayUntil` renvoie `pdFALSE`). Pour une tâche périodique : toujours `xTaskDelayUntil`. À priorité égale, `configUSE_TIME_SLICING` décide si les tâches se partagent le processeur à chaque tick.

## Partie 4 — La charge du processeur

**4.1 Les statistiques d'exécution**

FreeRTOS sait compter combien de temps **chaque tâche** a utilisé le processeur. À chaque changement de contexte, il lit une horloge fine et ajoute la durée écoulée au compteur de la tâche qui s'arrête. Il faut lui donner cette horloge : ce sera `Temps_us()`.

Dans `FreeRTOSConfig.h` :

1. Remplacer la ligne `#define configGENERATE_RUN_TIME_STATS 0` par :

```c
#define configGENERATE_RUN_TIME_STATS           1 /* TD2 partie 4 */
#define portCONFIGURE_TIMER_FOR_RUN_TIME_STATS() Outils_Init()
#define portGET_RUN_TIME_COUNTER_VALUE()         Temps_us()
```

2. Plus bas, dans le bloc qui contient `extern uint32_t SystemCoreClock;`, ajouter les deux déclarations, pour que les fichiers de FreeRTOS connaissent ces fonctions :

```c
    extern uint32_t SystemCoreClock;
    extern void Outils_Init(void);   /* TD2 partie 4 : outils_rtos.c */
    extern uint32_t Temps_us(void);
```

FreeRTOS appelle `Outils_Init()` au démarrage de l'ordonnanceur (le temps repart de 0 à ce moment-là) et `Temps_us()` à chaque changement de contexte. Le compteur de chaque tâche est en microsecondes, sur 32 bits : il déborde au bout de 71 minutes, largement assez pour un TD.

**Checkpoint :** la colonne **CPU** du moniteur se remplit. Sans calcul, IDLE est autour de **99 %**.

**4.2 Prévoir la charge, puis la mesurer**

Une tâche périodique de période **T** qui calcule pendant **C** à chaque période occupe une fraction **U = C / T** du processeur. Pour plusieurs tâches, on additionne : **U = C₁/T₁ + C₂/T₂ + …** Si U dépasse 100 %, c'est perdu d'avance.

Ajouter `#define CALCUL_STAB_MS 0` dans les réglages et `Calcul(CALCUL_STAB_MS);` dans `tache_stabilisation`, juste avant son `LOG`. On a maintenant un calcul réglable dans chacune des trois tâches.

| N° | `CALCUL_STAB_MS` | `CALCUL_NAV_MS` | `CALCUL_TELEM_MS` | U prévue | CPU mesuré (STAB, NAV, TELEM, IDLE) | Retards de NAV ? |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | 100 | 200 | 400 | | | |
| C2 | 100 | 300 | 800 | | | |
| C3 | 200 | 400 | 600 | | | |

Recopier ce tableau, calculer U **avant** chaque essai, puis comparer avec le moniteur (attendre deux affichages : le premier contient le démarrage).

**Questions**

1. Remplissez la colonne « U prévue ». Le moniteur confirme-t-il ? D'où viennent les petits écarts ?
2. Dans C3, quelle tâche souffre ? Comment le voit-on ?
3. **Liu et Layland (1973)** ont montré qu'avec des priorités choisies selon la règle « plus la période est courte, plus la priorité est haute » (*Rate Monotonic*), n tâches respectent **toujours** leurs échéances si U ≤ n (2^(1/n) − 1). Calculez cette borne pour n = 3. C2 la dépasse : pourquoi tout fonctionne-t-il quand même ?

??? success "Réponses (4.2)"
    1. **C1** : 100/500 + 200/1000 + 400/2000 = 0,2 + 0,2 + 0,2 = **60 %** (IDLE ≈ 40 %). **C2** : 0,2 + 0,3 + 0,4 = **90 %** (IDLE ≈ 10 %). **C3** : 0,4 + 0,4 + 0,3 = **110 %**. Les écarts viennent des affichages (`LOG`) et du moniteur, qui consomment aussi un peu de processeur, et de `Calcul` qui dure « au moins » la durée demandée.
    2. Le processeur ne suffit pas : c'est la tâche **la moins prioritaire** (TELEM) qui n'a plus assez de temps. Elle s'affiche de plus en plus tard (puis presque plus du tout), IDLE est à 0 %. STAB et NAV, plus prioritaires, restent à l'heure : `retards` de NAV reste à 0. FreeRTOS protège les tâches importantes en sacrifiant les autres : c'est pour cela que la priorité doit suivre l'**urgence**.
    3. 3 × (2^(1/3) − 1) = **0,78** soit 78 %. La borne est une condition **suffisante**, pas nécessaire : au-dessus, ça peut quand même marcher. Ici les périodes sont **harmoniques** (500, 1000 et 2000 : chacune divise la suivante) et dans ce cas particulier Rate Monotonic fonctionne jusqu'à **100 %** de charge.

!!! abstract "À retenir"
    Charge d'une tâche périodique : **U = C / T** ; on additionne les tâches. Au-delà de 100 %, quelqu'un rate ses échéances : avec des priorités fixes, ce sont les tâches les **moins prioritaires**. Les statistiques d'exécution (`configGENERATE_RUN_TIME_STATS`) mesurent le temps processeur de chaque tâche ; le temps d'IDLE est le temps **libre**. Règle *Rate Monotonic* : priorité haute aux périodes courtes, garantie si U ≤ 78 % pour 3 tâches (100 % si les périodes sont harmoniques).

## Partie 5 — Communiquer : les files de messages

**5.1 Le problème : une variable partagée**

NAV calcule la position du drone ; STAB s'en sert. Le drone vole sur la diagonale y = x : les deux coordonnées doivent **toujours** être égales. La façon naïve de partager la position est une variable globale.

1. En haut du fichier, après les `#define`, ajouter :

```c
typedef struct
{
    uint32_t numero; /* numero de la mesure GPS */
    int32_t x_m;     /* position en metres : le drone vole sur la diagonale y = x */
    int32_t y_m;
    uint32_t t_ms;   /* instant de la mesure */
} position_t;

static volatile position_t g_position; /* partie 5 : variable partagee SANS protection */
```

2. Dans `tache_navigation`, **remplacer** la ligne `Calcul(CALCUL_NAV_MS); /* le calcul de la position... */` par :

```c
        /* Partie 5 : mise a jour de la variable partagee en deux temps */
        int32_t nouvelle = (int32_t)n * 25; /* 25 m/s sur chaque axe */
        g_position.x_m   = nouvelle;
        Calcul(CALCUL_NAV_MS); /* le calcul de y prend du temps */
        g_position.y_m = nouvelle;
```

3. Dans `tache_stabilisation`, au début de la boucle (juste après `n++;`) :

```c
        /* Partie 5 : lecture de la position partagee (sans protection) ... */
        int32_t x = g_position.x_m;
        int32_t y = g_position.y_m;
        if (x != y)
        {
            LOG("[%6u ms] STAB  : POSITION INCOHERENTE x=%d y=%d\r\n", Temps_ms(), (int)x, (int)y);
        }
```

**Expérience :** avec `CALCUL_NAV_MS 0`, puis avec `CALCUL_NAV_MS 600`. Que voit-on ?

??? success "Réponse (5.1)"
    Avec 0 ms, rien d'anormal. Avec 600 ms, des lignes `POSITION INCOHERENTE x=25 y=0`, puis `x=50 y=25`… apparaissent. NAV écrit `x` à l'instant 0, calcule `y` pendant 600 ms ; à 500 ms, STAB (plus prioritaire) **préempte** NAV au milieu de sa mise à jour et lit un `x` neuf avec un `y` ancien. C'est une **condition de course** (*race condition*) : le résultat dépend de l'instant exact de la préemption. Avec un calcul très court, le bug existe toujours, il est simplement **rare** — c'est le pire genre de bug : invisible en test, présent en vol. (On a mis un calcul long exprès pour le rendre visible.)

**5.2 La solution : copier le message d'un seul coup**

Une **file** (*queue*) FreeRTOS est une boîte de messages de taille fixe. `xQueueSend` **copie** le message dans la file, `xQueueReceive` le **copie** hors de la file, et FreeRTOS garantit que la copie ne peut pas être coupée en deux par une autre tâche. Le lecteur reçoit donc toujours un message **entier** et cohérent.

On en crée deux :

- une **boîte aux lettres** de **1** place, NAV → STAB : `xQueueOverwrite` remplace l'ancienne position par la nouvelle, `xQueuePeek` lit la dernière position **sans la retirer** (STAB la relit à chaque tour) ;
- une **file** de **4** places, NAV → TELEM : chaque position est envoyée une fois, dans l'ordre, et TELEM n'a plus besoin d'être périodique : elle **attend** les positions.

1. Ajouter `#include "queue.h"` et `#include "semphr.h"` après `#include "task.h"`, et dans les réglages :

```c
#define LONGUEUR_FILE_TELEM 4 /* partie 5 : places dans la file NAV -> TELEM */
```

2. Sous `g_position`, ajouter :

```c
static QueueHandle_t boite_position; /* partie 5 : boite aux lettres (1 place) NAV -> STAB */
static QueueHandle_t file_telem;     /* partie 5 : file NAV -> TELEM */
static volatile uint32_t g_positions_perdues = 0;
```

3. Dans `main()`, avant les `Creer(...)` :

```c
    boite_position = xQueueCreate(1, sizeof(position_t));
    file_telem     = xQueueCreate(LONGUEUR_FILE_TELEM, sizeof(position_t));
```

4. Dans `tache_navigation`, déclarer `position_t pos;` au début de la boucle, et juste **après** `g_position.y_m = nouvelle;` :

```c
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
```

5. Dans `tache_stabilisation`, déclarer `position_t pos;` au début de la boucle, et après le test `if (x != y) {...}` :

```c
        /* ... puis lecture de la boite aux lettres (protegee) */
        if (xQueuePeek(boite_position, &pos, 0) == pdPASS && pos.x_m != pos.y_m)
        {
            LOG("[%6u ms] STAB  : boite incoherente ?!\r\n", Temps_ms());
        }
```

6. Remplacer `tache_telemetrie` par une tâche qui **attend** les positions :

```c
/* ---------- Tache 3 : telemetrie (attend les positions dans la file) ---------- */
static void tache_telemetrie(void *pvParameters)
{
    for (;;)
    {
        position_t pos;
        xQueueReceive(file_telem, &pos, portMAX_DELAY); /* bloquee tant que la file est vide */
        Calcul(CALCUL_TELEM_MS);
        LOG("[%6u ms] TELEM : envoi position n%u (%d m, %d m) mesuree a %u ms, perdues %u\r\n", Temps_ms(),
            (unsigned)pos.numero, (int)pos.x_m, (int)pos.y_m, (unsigned)pos.t_ms, (unsigned)g_positions_perdues);
    }
}
```

(`PERIODE_TELEM_MS` ne sert plus : on peut supprimer sa ligne.)

**Checkpoint :** avec `CALCUL_NAV_MS 600`, les lignes `POSITION INCOHERENTE` continuent (variable globale), mais **jamais** `boite incoherente`. TELEM affiche chaque position juste après NAV.

**5.3 Expériences**

| N° | Modifier | Observer |
| --- | --- | --- |
| Q1 | Rien | Dans quel état le moniteur montre-t-il TELEM entre deux positions ? |
| Q2 | `CALCUL_TELEM_MS 3000` | Combien de positions TELEM affiche-t-elle ? Que devient `perdues` ? |
| Q3 | `CALCUL_TELEM_MS 3000` et `LONGUEUR_FILE_TELEM 20` | Et maintenant ? Est-ce une solution ? |

??? success "Réponses (5.3)"
    - **Q1.** `B` : TELEM est **bloquée sur la file** ; elle ne consomme rien. Dès que NAV envoie une position, FreeRTOS la réveille. On est passé d'une tâche **périodique** à une tâche **sur événement** : TELEM travaille exactement quand il y a du travail.
    - **Q2.** TELEM met 3 s par position alors que NAV en produit une par seconde. La file se remplit (4 places), puis `xQueueSend(..., 0)` échoue et `perdues` augmente d'environ 2 toutes les 3 s. Les positions affichées sont de plus en plus **anciennes** (comparer `mesuree a` et l'heure de la ligne). On a choisi le délai 0 pour que NAV, plus importante, ne soit **jamais** bloquée par la télémétrie.
    - **Q3.** La file met plus longtemps à se remplir (20 positions), mais elle se remplit quand même, et les positions envoyées ont jusqu'à 20 s de retard. Une file **absorbe des pics** ; elle ne résout pas un consommateur trop lent en moyenne. Solutions : accélérer TELEM, n'envoyer qu'une position sur trois, ou n'envoyer que la plus récente (boîte aux lettres).

!!! abstract "À retenir"
    Partager une variable entre tâches sans protection crée une **condition de course** : un lecteur plus prioritaire peut lire une donnée à moitié écrite. Une **file** FreeRTOS **copie** des messages entiers, dans l'ordre (FIFO) ; `xQueueReceive(..., portMAX_DELAY)` **bloque** la tâche jusqu'à l'arrivée d'un message. Une file de 1 place avec `xQueueOverwrite` / `xQueuePeek` est une **boîte aux lettres** : toujours la dernière valeur. Choisir le délai d'envoi : 0 pour un producteur qui ne doit jamais attendre (et compter les pertes).

## Partie 6 — Réagir à une interruption : l'arrêt d'urgence

L'opérateur appuie sur **SW2** : le drone doit réagir **immédiatement**, même si une autre tâche calcule. Au TD1, l'interruption levait un drapeau que la boucle principale scrutait. Avec FreeRTOS, l'interruption **réveille une tâche** qui fait le travail.

**6.1 Le code**

1. Ajouter `#include <stdbool.h>` et `#include "fsl_gpio.h"` en haut du fichier, puis dans les réglages :

```c
#define PRIO_URGENCE  4
#define AVEC_YIELD_FROM_ISR 1 /* partie 6 : 1 = portYIELD_FROM_ISR, 0 = sans */
```

2. Déclarer `static TaskHandle_t h_urgence;` (à côté de `h_nav`) et `static volatile uint32_t g_t_appui_us;`.
3. Ajouter, avant `main()`, le bouton (comme au TD1, mais le `pin_mux.c` de `freertos_hello` n'active que le port 1 : on active aussi le port 0), l'interruption et la tâche :

```c
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
```

4. Dans `main()`, avant les `Creer(...)` :

```c
    BOUTON_Init(BOARD_SW2_GPIO_PIN);
    NVIC_SetPriority(BOARD_SW2_IRQ, 3); /* >= configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY (2) */
    EnableIRQ(BOARD_SW2_IRQ);
```

et avec les autres :

```c
    Creer(tache_urgence, "Urgence", PILE_TACHE, PRIO_URGENCE, &h_urgence);
```

**Ce qu'il faut comprendre**

- Chaque tâche possède une **notification** : un compteur intégré à son TCB. `vTaskNotifyGiveFromISR` l'augmente de 1 ; `ulTaskNotifyTake(pdTRUE, ...)` bloque la tâche tant qu'il vaut 0, puis le remet à 0. C'est le moyen le plus **léger** et le plus **rapide** de réveiller une tâche précise.
- Dans une interruption, on n'utilise **que** les fonctions qui finissent par **`FromISR`** : une interruption ne peut pas se bloquer, elle n'est pas une tâche.
- `reveilFaible` passe à `pdTRUE` si la tâche réveillée est plus prioritaire que celle qui a été interrompue. `portYIELD_FROM_ISR(pdTRUE)` demande alors le changement de contexte **dès la sortie** de l'interruption.
- **Priorité de l'interruption.** Sur le Cortex-M33, 0 est la priorité **la plus haute**. Les interruptions qui appellent FreeRTOS doivent avoir une priorité **numériquement ≥ `configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY`** (2 dans `FreeRTOSConfig.h`) : FreeRTOS peut alors les masquer quand il modifie ses listes. Une interruption de priorité 0 ou 1 n'est **jamais** masquée : elle peut arriver au milieu d'une mise à jour des listes et les corrompre. Attention : ce portage de FreeRTOS **ne vérifie pas** cette règle, le bug serait aléatoire.

**Checkpoint :** un appui sur SW2 affiche `URGENCE : retour a la base ! (latence ... us)`.

**6.2 Expériences**

| N° | Modifier | Observer |
| --- | --- | --- |
| I1 | Rien. Appuyer 10 fois | Latence minimale et maximale ? |
| I2 | `CALCUL_TELEM_MS 3000` (TELEM calcule souvent). Appuyer 10 fois | La latence change-t-elle ? |
| I3 | `AVEC_YIELD_FROM_ISR 0`. Appuyer 10 fois | Latence minimale et maximale ? |

??? success "Réponses (6.2)"
    - **I1.** Quelques microsecondes à quelques dizaines de microsecondes : le temps de l'interruption, du changement de contexte et de la sortie de `ulTaskNotifyTake`. (Si un `LOG` d'une autre tâche est en cours au moment de l'appui, la latence mesurée peut être plus grande : la tâche Urgence attend la console pour afficher, mais la mesure de la latence, elle, a déjà eu lieu avant le `LOG`.)
    - **I2.** Non : Urgence (priorité 4) **préempte** TELEM en plein calcul. La latence ne dépend pas du travail des tâches moins prioritaires : c'est tout l'intérêt de l'ordonnancement préemptif.
    - **I3.** La latence varie entre presque 0 et **1000 µs** (un tick). Sans `portYIELD_FROM_ISR`, l'interruption revient à la tâche interrompue ; FreeRTOS ne change de tâche qu'au **tick suivant** (ou quand la tâche interrompue se bloque). On perd jusqu'à une période de tick.

**6.3 Notification, sémaphore, file : que choisir ?**

On aurait pu réveiller la tâche Urgence avec un **sémaphore binaire** : `xSemaphoreGiveFromISR(sem, &reveilFaible)` dans l'interruption, `xSemaphoreTake(sem, portMAX_DELAY)` dans la tâche. Ça marche aussi, mais un sémaphore est un objet séparé (créé dans le tas, avec sa propre liste de tâches en attente), plus lourd et un peu plus lent.

| Outil | Pour quoi faire | Remarque |
| --- | --- | --- |
| Notification | Réveiller **une** tâche précise, éventuellement compter les événements | Le plus léger ; un seul destinataire |
| Sémaphore binaire | Signaler un événement, sans savoir à l'avance quelle tâche l'attendra | Plusieurs tâches peuvent attendre le même |
| Sémaphore à compteur | Compter des événements ou des ressources disponibles (`xSemaphoreCreateCounting`) | |
| File | Transmettre une **donnée** avec l'événement (une valeur lue, un horodatage) | Copie du message |
| Mutex | **Protéger** une ressource partagée (partie 7) | Ce n'est **pas** un outil de signalisation |

**Questions**

1. Pourquoi ne met-on pas le `LOG` directement dans l'interruption ?
2. Pourquoi l'anti-rebond est-il dans la tâche et pas dans l'interruption ?
3. Si l'opérateur appuie 3 fois très vite avant que la tâche Urgence ne s'exécute, combien de fois s'exécute-t-elle avec `ulTaskNotifyTake(pdTRUE, ...)` ? Et avec `pdFALSE` ?

??? success "Réponses (6.3)"
    1. Une interruption doit être **courte** : un `LOG` dure plusieurs millisecondes et peut se bloquer sur le mutex de la console (interdit dans une interruption). On déporte le travail dans une tâche, et l'interruption ne fait que la **réveiller**. C'est le schéma « interruption courte, tâche différée ».
    2. Dans la tâche, on peut **dormir** 300 ms avec `vTaskDelay` sans gêner personne. Dans l'interruption, attendre bloquerait tout le système.
    3. Avec `pdTRUE`, `ulTaskNotifyTake` remet le compteur à 0 : **une seule** exécution pour les 3 appuis (comportement d'un sémaphore binaire). Avec `pdFALSE`, il retire 1 : **trois** exécutions (comportement d'un sémaphore à compteur).

!!! abstract "À retenir"
    Interruption **courte** qui **réveille une tâche** (fonctions `...FromISR` uniquement), tâche qui fait le travail. `portYIELD_FROM_ISR` évite d'attendre le tick suivant. Les interruptions qui appellent FreeRTOS ont une priorité numérique **≥ `configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY`** (2). Pour réveiller une tâche précise : **notification** ; pour transmettre une donnée : **file**.

## Partie 7 — Partager une ressource : mutex et inversion de priorité

**7.1 La console est une ressource partagée**

Chaque `PRINTF` envoie ses caractères sur la liaison série, à 115 200 bauds : 10 bits par caractère (8 bits + départ + arrêt), soit **87 µs par caractère**. Une ligne de 60 caractères occupe la liaison **5 ms**, et dans `freertos_hello` le `PRINTF` attend la fin de l'envoi.

Que se passe-t-il si une tâche plus prioritaire appelle `PRINTF` pendant qu'une autre est en train d'écrire ? Dans la console du SDK utilisée par `freertos_hello`, le second envoi trouve la liaison **occupée** et est **abandonné** sans prévenir : la ligne disparaît. (Avec la console « lite » de l'exemple eIQ de la partie 9, les caractères des deux lignes se **mélangent**.)

On protège la console avec un **mutex** (*mutual exclusion*) : une seule tâche à la fois peut le prendre ; les autres attendent, **bloquées**, qu'il soit rendu. C'est ce que fait `LOG` dès que le mutex `g_console` existe :

```c
#define LOG(...)                                                      \
    do                                                                \
    {                                                                 \
        if (g_console != NULL) xSemaphoreTake(g_console, portMAX_DELAY); \
        PRINTF(__VA_ARGS__);                                          \
        if (g_console != NULL) xSemaphoreGive(g_console);             \
    } while (0)
```

Le mutex est créé par `Console_Init()`, appelé dans `main()` depuis la partie 1. Tant que `g_console` vaut `NULL`, `LOG` se comporte comme un simple `PRINTF`.

**Expérience C1 :** mettre `Console_Init();` en commentaire dans `main()` et `PERIODE_STAB_MS 10` (STAB affiche une ligne toutes les 10 ms). Regarder les numéros `n` de STAB : en manque-t-il ? Quand ?

**Expérience C2 :** remettre `Console_Init();`, toujours avec `PERIODE_STAB_MS 10`. Les lignes disparaissent-elles encore ? Regardez les **instants** affichés par STAB : sont-ils réguliers ?

??? success "Réponses (7.1)"
    - **C1.** Il manque des numéros, surtout quand NAV, TELEM ou le moniteur affichent : STAB les préempte au milieu de leur envoi, trouve la liaison occupée, et sa ligne est perdue. (La ligne de la tâche interrompue, elle, se termine normalement.)
    - **C2.** Plus de perte, mais STAB est parfois en retard de plusieurs millisecondes (jusqu'à plusieurs dizaines quand le moniteur affiche son tableau, qu'il imprime d'un seul bloc en gardant le mutex) : elle **attend** que la tâche qui tient la console ait fini. Protéger une ressource partagée, c'est accepter que la tâche la plus urgente puisse **attendre** une tâche moins urgente. Il faut donc garder un mutex le **moins longtemps possible**. Et une tâche vraiment critique ne devrait pas afficher du tout : c'est ce qu'on fera en partie 9 (seule RADIO affiche).

**7.2 L'inversion de priorité**

Le 4 juillet 1997, la sonde **Mars Pathfinder** se pose sur Mars. Quelques jours plus tard, elle redémarre toute seule, plusieurs fois. La cause : une tâche très prioritaire attendait une ressource tenue par une tâche peu prioritaire… elle-même empêchée de s'exécuter par des tâches de priorité moyenne. On va reproduire ce scénario.

Le drone a un **bus de capteurs** partagé : STAB (priorité 3) y lit le gyroscope, TELEM (priorité 1) y lit la batterie, pendant 100 ms. NAV (priorité 2) n'utilise pas le bus, mais calcule 400 ms.

```
temps (ms)   0        20  40                     440      500
TELEM p1     [prend le bus ......         .....rend]
STAB  p3              [veut le bus : BLOQUEE .....................] -> obtient le bus
NAV   p2                  [====== calcul 400 ms ======]
```

1. Ajouter dans les réglages :

```c
#define BUS_PAR_MUTEX       1 /* partie 7 : 1 = mutex, 0 = semaphore binaire */
#define DEMO_INVERSION      0 /* partie 7 : 1 = scenario d'inversion de priorite */
```

et `static SemaphoreHandle_t g_bus;      /* partie 7 : bus des capteurs partage */` sous les autres variables.

2. Dans `main()`, après `Console_Init();` :

```c
#if BUS_PAR_MUTEX
    g_bus = xSemaphoreCreateMutex();
#else
    g_bus = xSemaphoreCreateBinary();
    xSemaphoreGive(g_bus); /* un semaphore binaire est cree "vide" : on le rend disponible */
#endif
```

3. Dans `tache_stabilisation`, juste **avant** `TickType_t reveil = ...`, puis au début de la boucle (après `n++;`) :

```c
#if DEMO_INVERSION
    vTaskDelay(pdMS_TO_TICKS(20)); /* decalage : se reveille pendant que TELEM tient le bus */
#endif
```

```c
#if DEMO_INVERSION
        uint32_t t0 = Temps_us();
        xSemaphoreTake(g_bus, portMAX_DELAY); /* lit le gyroscope sur le bus */
        uint32_t attente = Temps_us() - t0;
        xSemaphoreGive(g_bus);
        LOG("[%6u ms] STAB  : a attendu le bus %u ms\r\n", Temps_ms(), (unsigned)(attente / 1000U));
#endif
```

4. Dans `tache_navigation`, juste **après** `TickType_t reveil = xTaskGetTickCount();` :

```c
#if DEMO_INVERSION
    vTaskDelay(pdMS_TO_TICKS(40));
    reveil = xTaskGetTickCount();
#endif
```

5. Dans `tache_telemetrie`, au début de la boucle, encadrer l'ancien contenu :

```c
#if DEMO_INVERSION
        xSemaphoreTake(g_bus, portMAX_DELAY); /* lit la batterie sur le bus... */
        LOG("[%6u ms] TELEM : prend le bus (priorite %u)\r\n", Temps_ms(), (unsigned)uxTaskPriorityGet(NULL));
        Calcul(100);                          /* ... pendant 100 ms */
        LOG("[%6u ms] TELEM : rend le bus (priorite %u)\r\n", Temps_ms(), (unsigned)uxTaskPriorityGet(NULL));
        xSemaphoreGive(g_bus);
        vTaskDelay(pdMS_TO_TICKS(2000));
#else
        /* ... l'ancien contenu de la boucle : xQueueReceive, Calcul, LOG ... */
#endif
```

Pour une mesure propre, mettre en commentaire la création de la tâche **Mesure** dans `main()` : ses affichages du début décaleraient le scénario de quelques millisecondes.

**Expériences** (regarder le **premier** cycle, de 0 à 600 ms) :

| N° | Modifier | Observer |
| --- | --- | --- |
| M1 | `DEMO_INVERSION 1`, `BUS_PAR_MUTEX 0`, `CALCUL_NAV_MS 400` | Combien de temps STAB a-t-elle attendu le bus ? Quelle priorité affiche TELEM ? |
| M2 | Pareil avec `BUS_PAR_MUTEX 1` | Et maintenant ? |

??? success "Réponses (7.2)"
    - **M1 (sémaphore binaire).** STAB attend **environ 480 ms** : TELEM prend le bus à 0 ms ; STAB le demande à 20 ms et se bloque ; à 40 ms NAV se réveille et, plus prioritaire que TELEM, la **préempte** pendant 400 ms ; TELEM ne peut finir et rendre le bus que vers 500 ms. La tâche la plus prioritaire attend une tâche de priorité **moyenne** qui n'a rien à voir avec le bus : c'est l'**inversion de priorité**. TELEM affiche toujours la priorité 1. (Vous verrez peut-être aussi `POSITION INCOHERENTE` : NAV calcule 400 ms entre `x` et `y`, c'est l'expérience de la partie 5.)
    - **M2 (mutex).** STAB attend **environ 80 ms** (le reste des 100 ms de TELEM). Quand STAB se bloque sur le mutex, FreeRTOS donne **temporairement** à TELEM la priorité de STAB (3) : c'est l'**héritage de priorité**. NAV (2) ne peut plus la préempter ; TELEM finit vite, rend le mutex, retrouve sa priorité 1, et STAB repart. Le message « rend le bus » affiche la priorité **3**. Pathfinder a été réparée à distance en activant l'héritage de priorité sur le sémaphore en cause.

!!! abstract "À retenir"
    Une ressource partagée (console, bus, variable) se protège avec un **mutex** : `xSemaphoreTake` avant, `xSemaphoreGive` après, et le moins longtemps possible. Un mutex fait de l'**héritage de priorité** : la tâche qui le tient prend la priorité de la plus prioritaire qui l'attend. Sans cela (sémaphore binaire), une tâche moyenne peut retarder indéfiniment une tâche urgente : **inversion de priorité**. Sémaphore = **signaler** ; mutex = **protéger**.

## Partie 8 — La mémoire : pile et tas

**8.1 Où vit une tâche ?**

`xTaskCreate` réserve deux blocs dans le **tas** de FreeRTOS (`heap_4.c`, un tableau `ucHeap` de `configTOTAL_HEAP_SIZE` octets) : le **TCB** et la **pile** de la tâche (taille donnée en **mots** de 4 octets). Les files, les sémaphores et les mutex sont aussi créés dans le tas. Le moniteur affiche :

- **tas libre** (`xPortGetFreeHeapSize`) et **minimum** atteint depuis le démarrage (`xPortGetMinimumEverFreeHeapSize`) ;
- pour chaque tâche, la **pile libre** au pire moment (`usStackHighWaterMark`) : à la création, FreeRTOS remplit la pile d'un motif connu (`0xA5`) ; il compte ensuite combien de mots n'ont jamais été écrasés.

**8.2 Les filets de sécurité**

Dans `FreeRTOSConfig.h`, passer :

```c
#define configCHECK_FOR_STACK_OVERFLOW          2 /* TD2 partie 8 */
#define configUSE_MALLOC_FAILED_HOOK            1 /* TD2 partie 8 */
```

- `configCHECK_FOR_STACK_OVERFLOW 2` : à chaque changement de contexte, FreeRTOS vérifie que le sommet de la pile n'a pas dépassé la limite et que les derniers mots de la pile ont toujours le motif `0xA5`. Sinon, il appelle `vApplicationStackOverflowHook()` (dans `outils_rtos.c`) qui affiche le nom de la tâche et arrête tout.
- `configUSE_MALLOC_FAILED_HOOK 1` : si le tas est plein, `vApplicationMallocFailedHook()` est appelée.
- En plus, le Cortex-M33 a un garde-fou **matériel** : le registre **PSPLIM** (vu en partie 1) contient la limite basse de la pile de la tâche en cours ; s'il est franchi, le processeur déclenche une **faute** (dans le débogueur, le programme s'arrête dans `HardFault_Handler`). Selon le débordement, c'est le matériel ou le crochet qui le détecte en premier.

**8.3 Expériences**

1. Ajouter `#define TAILLE_TAMPON_TELEM 0 /* partie 8 : octets de tableau local dans TELEM */` dans les réglages, et dans `tache_telemetrie` :

```c
#if TAILLE_TAMPON_TELEM > 0
    volatile uint8_t tampon[TAILLE_TAMPON_TELEM]; /* partie 8 : un gros tableau sur la pile */
#endif
```

au début de la fonction, et après `xQueueReceive(...)` :

```c
#if TAILLE_TAMPON_TELEM > 0
        for (int i = 0; i < TAILLE_TAMPON_TELEM; i++)
        {
            tampon[i] = (uint8_t)i; /* remplit le tableau... sur la pile ! */
        }
        (void)tampon[0];
#endif
```

| N° | Modifier | Observer |
| --- | --- | --- |
| P1 | Rien | Relever la pile libre de chaque tâche et le tas libre |
| P2 | `TAILLE_TAMPON_TELEM 400` | Pile libre de TELEM ? Le calcul est-il cohérent ? |
| P3 | `TAILLE_TAMPON_TELEM 2000` | Que se passe-t-il ? (lancer en **Debug**, puis **Suspend** si le terminal se tait) |
| P4 | Remettre 0. Dans `main()`, créer NAV avec une pile de `5000` mots | Que se passe-t-il ? |

??? success "Réponses (8.3)"
    - **P1.** Chaque tâche a 290 mots ; il en reste environ 150 à 200 (les `LOG` sont les plus gourmands : le formatage des nombres utilise la pile). Ce sont des mesures, pas des garanties : un chemin du code jamais exécuté pendant la mesure peut utiliser davantage.
    - **P2.** La pile libre de TELEM baisse d'environ **100 mots** : 400 octets / 4 = 100 mots. La pile de chaque tâche contient ses **variables locales** : un gros tableau local a sa place en `static` ou en variable globale, pas sur la pile.
    - **P3.** 2000 octets = 500 mots, plus que les 290 mots de la pile : le programme s'arrête dès que la tâche TELEM démarre (le tableau est réservé sur la pile à l'entrée de la fonction). Soit le terminal affiche `!!! DEBORDEMENT DE PILE dans la tache Telem !!!` (crochet de FreeRTOS), soit le débogueur s'arrête dans `HardFault_Handler` (PSPLIM, matériel). Sans ces protections, le tableau aurait écrasé la mémoire **voisine** (le TCB ou la pile d'une autre tâche) : plantage aléatoire, beaucoup plus tard, ailleurs.
    - **P4.** 5000 mots = 20 000 octets, plus que le tas libre : le terminal affiche `!!! PLUS DE MEMOIRE ...` (crochet `MallocFailed`). Sans le crochet, `xTaskCreate` renverrait une erreur et notre fonction `Creer` afficherait `Creation de la tache Nav impossible`.

??? note "Fichier `freertos_hello.c` complet, parties 1 à 8"

    ```c
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
    ```

??? note "Résumé des modifications de `FreeRTOSConfig.h` (parties 1 à 8)"

    ```c
    #define configTICK_RATE_HZ                      ((TickType_t)1000) /* partie 1 : 200 -> 1000 */
    #define configTOTAL_HEAP_SIZE                   ((size_t)(20 * 1024)) /* partie 2 : 10 -> 20 Ko */
    #define configCHECK_FOR_STACK_OVERFLOW          2 /* partie 8 */
    #define configUSE_MALLOC_FAILED_HOOK            1 /* partie 8 */
    #define configGENERATE_RUN_TIME_STATS           1 /* partie 4 */
    #define portCONFIGURE_TIMER_FOR_RUN_TIME_STATS() Outils_Init()
    #define portGET_RUN_TIME_COUNTER_VALUE()         Temps_us()
    ...
        extern uint32_t SystemCoreClock;
        extern void Outils_Init(void);   /* partie 4 : outils_rtos.c */
        extern uint32_t Temps_us(void);
    ```

!!! abstract "À retenir"
    Pile et TCB de chaque tâche, files et mutex sont pris dans le **tas** FreeRTOS (`configTOTAL_HEAP_SIZE`). La pile contient les **variables locales** : pas de gros tableaux locaux dans une tâche. On dimensionne une pile en **mesurant** (`usStackHighWaterMark`) puis en gardant une marge. Un débordement de pile écrase la mémoire voisine : on active `configCHECK_FOR_STACK_OVERFLOW` (et le Cortex-M33 a PSPLIM).

## Partie 9 — Synthèse : VIGIE voit, avec MobileNet sur le NPU

On assemble tout dans le programme final : des tâches **périodiques** (stabilisation, caméra), une tâche **sur événement** qui exécute un réseau de neurones **MobileNet** sur le **NPU** (vision), des **files** entre elles, une **interruption** (SW2 : photo à la demande), un **mutex** (console), et le **moniteur** pour vérifier que tout est à l'heure.

Le point de départ est l'exemple **`tflm_label_image`** du TP1 (MobileNet v1 0,25, entrée 128 × 128 × 3, 1001 classes, converti pour le NPU : un seul gros opérateur `NeutronGraph`). Cet exemple n'utilise **pas** FreeRTOS : on va l'ajouter.

**9.1 Importer l'exemple et lui ajouter FreeRTOS**

1. **Import SDK example(s)** → **eiq\_examples** → **tflm\_label\_image**, préfixe `TD2_`. **Build**, **Debug**, **Resume** : on retrouve `Detected: stopwatch` comme au TP1.
2. Ajouter FreeRTOS au projet : clic droit sur le projet → **SDK Management** → **Manage SDK Components** → onglet **Middleware** → cocher **FreeRTOS kernel** (avec ses composants proposés, en particulier **heap\_4**) → **OK**, accepter l'ajout des fichiers. (Les intitulés exacts peuvent varier un peu selon la version de l'IDE.)
3. Copier dans le dossier `source` du projet les fichiers **`FreeRTOSConfig.h`**, **`outils_rtos.c`** et **`outils_rtos.h`** du projet des parties 1 à 8 (si l'IDE a déjà créé un `FreeRTOSConfig.h`, le remplacer). Dans ce `FreeRTOSConfig.h`, passer le tas à **24 Ko** : `configTOTAL_HEAP_SIZE ((size_t)(24 * 1024))`.
4. **Build.** L'édition de liens échoue avec :

```
multiple definition of `SysTick_Handler'
```

**Question :** que signifie ce message ? Quels sont les deux fichiers en conflit ?

??? success "Réponse (9.1)"
    Deux fichiers définissent la même fonction `SysTick_Handler` : `source/timer.c` de l'exemple eIQ, qui utilise le SysTick pour **mesurer** le temps d'inférence (une interruption par milliseconde qui incrémente `msTicks`), et `port.c` de FreeRTOS, qui l'utilise pour le **tick** (partie 1). Il n'y a qu'un SysTick : il appartient désormais à FreeRTOS. On mesurera le temps avec `Temps_us()` (compteur de cycles), qui n'a besoin d'aucune interruption.

5. Dans `source/timer.c` : **supprimer** la fonction `SysTick_Handler` et la variable `msTicks`, ajouter `#include "outils_rtos.h"`, et remplacer les deux fonctions `TIMER_Init` et `TIMER_GetTimeInUS` par :

```c
void TIMER_Init(void)
{
    Outils_Init(); /* plus de SysTick ici : il appartient a FreeRTOS */
}

int TIMER_GetTimeInUS(void)
{
    return (int)Temps_us();
}
```

(Garder la fin du fichier, `gettimeofday`, qui s'appuie sur `TIMER_GetTimeInUS`.)

??? note "Fichier `timer.c` complet après modification"

    ```c
    /*
     * Copyright 2018-2020 NXP
     * All rights reserved.
     *
     * SPDX-License-Identifier: BSD-3-Clause
     */

    /* timer.c (TD2, partie 9) : version compatible FreeRTOS.
       L'original utilisait l'interruption SysTick, que FreeRTOS utilise deja pour son tick.
       On mesure maintenant le temps avec Temps_us() (compteur de cycles DWT, outils_rtos.c). */
    #include "board.h"
    #include "timer.h"
    #include "outils_rtos.h"

    #include <stdint.h>
    #if defined(__ICCARM__) || defined(__ARMCC_VERSION) || defined(__REDLIB__)
    #include <time.h>
    #else
    #include <sys/time.h>
    #endif

    void TIMER_Init(void)
    {
        Outils_Init(); /* plus de SysTick ici : il appartient a FreeRTOS */
    }

    int TIMER_GetTimeInUS(void)
    {
        return (int)Temps_us();
    }

    #if defined(__ARMCC_VERSION) || defined(__REDLIB__)

    clock_t clock ()
    {
        return ((uint64_t)TIMER_GetTimeInUS() * CLOCKS_PER_SEC) / 1000000;
    }

    #elif defined(__ICCARM__)

    int timespec_get(struct timespec* ts, int base)
    {
        int us = TIMER_GetTimeInUS();
        ts->tv_sec = us / 1000000;
        ts->tv_nsec = (us % 1000000) * 1000;
        return TIME_UTC ;
    }

    #else

    int gettimeofday(struct timeval *__restrict __p,void *__restrict __tz){
        int us = TIMER_GetTimeInUS();
        __p->tv_sec = us / 1000000;
        __p->tv_usec = us % 1000000;
        return 0;
    }

    #endif
    ```

**9.2 Le programme du drone**

Remplacer **tout le contenu** de `source/main.cpp` par le programme ci-dessous.

??? note "Fichier `main.cpp` du drone VIGIE (à copier)"

    ```cpp
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
    ```

**Ce qu'il faut comprendre dans ce programme**

| Tâche | Priorité | Déclenchement | Travail |
| --- | --- | --- | --- |
| Stab | 4 | Toutes les 10 ms (`xTaskDelayUntil`) | 1 ms de calcul ; mesure sa **gigue** et ses **échéances ratées** |
| Camera | 3 | Toutes les 500 ms **ou** sur notification de SW2 | « Prend » une photo (adresse d'une image en Flash) et l'envoie dans `file_images` |
| Vision | 2 | À chaque photo reçue | Copie la photo dans le tenseur d'entrée, **inférence MobileNet sur le NPU**, meilleure classe, envoi dans `file_resultats` |
| Radio | 1 | À chaque résultat reçu | Ligne `$VIGIE,...` sur le terminal, LED : **rouge** = cible trouvée, **bleue** = autre objet, **verte** = rien |
| Moniteur | 1 | Toutes les 5 s | Tableau des tâches + statistiques d'inférence et de STAB |

- **La photo ne voyage pas** : elle fait 49 152 octets. La file transporte une petite structure `trame_t` (numéro, **adresse** des pixels, heure de capture). C'est ce que fait une vraie caméra avec un DMA : elle remplit un tampon et on se passe son adresse.
- **La caméra est périodique et sur événement à la fois.** Au lieu de `xTaskDelayUntil`, elle attend avec `ulTaskNotifyTake(pdTRUE, reste)` : elle se réveille soit à l'échéance (le délai `reste` expire, la fonction renvoie 0), soit **tout de suite** si l'interruption de SW2 la notifie.
- **`MODEL_Init()` est appelé dans `main()`, avant l'ordonnanceur** : il prépare l'interpréteur TensorFlow Lite Micro, la mémoire des tenseurs (`s_tensorArena`, 256 Ko) et le NPU, une seule fois, sur la pile de `main` (8 Ko).
- **Seule la tâche Vision utilise le modèle** : l'interpréteur n'est pas prévu pour être utilisé par deux tâches à la fois.
- **Pendant l'inférence, que fait le processeur ?** La fonction du SDK qui lance le NPU (`neutronRunBlocking`) ne rend la main qu'à la fin du calcul. Pour FreeRTOS, Vision reste donc **en cours** pendant toute l'inférence, mais elle peut être **préemptée** par Stab et Camera, plus prioritaires. (La bibliothèque Neutron est fournie compilée : l'expérience V3 permet de vérifier ce comportement.)
- **`extern "C"`** : `main.cpp` est un fichier C++. Le nom de la fonction d'interruption doit rester un nom C, sinon le compilateur le « décore », la table des vecteurs ne la trouve pas, et l'appui sur SW2 tombe dans le gestionnaire par défaut.
- **Une seule tâche affiche** (Radio, plus le Moniteur) : Stab, la plus urgente, n'appelle jamais `LOG`. On a vu en partie 7 qu'afficher, c'est risquer d'attendre.

**Checkpoint :** **Build**, **Debug**, **Resume**. Le terminal affiche (valeurs indicatives) :

```
Label image example using a TensorFlow Lite Micro model.
Detection threshold: 23%
Model: mobilenet_v1_0.25_128_quant_int8_npu
VIGIE : 1 image(s), une photo toutes les 500 ms, cible : stopwatch
[    20 ms] $VIGIE,0,stopwatch,stopwatch,86%,inference 13000 us,latence 19 ms  <<< CIBLE TROUVEE
[   520 ms] $VIGIE,1,stopwatch,stopwatch,86%,inference 13000 us,latence 19 ms  <<< CIBLE TROUVEE
...
---- Moniteur a 5000 ms : 7 taches, tas libre ... ----
Tache        Etat Prio  Pile libre (mots)  CPU
Moniteur      X   1      ...
...
Inference (us) : min ..., moy ..., max ... sur 10 | photos perdues 0, resultats perdus 0
STAB : echeances ratees 0, gigue max ... us
```

La LED est **rouge** : la cible (`stopwatch`) est trouvée.

**9.3 Questions sur le fonctionnement normal**

1. Relever le temps d'inférence (min, moyen, max). Comparer avec le TP1 (12 ms). Pourquoi est-il un peu plus long et pourquoi varie-t-il ?
2. Relever la part de processeur de chaque tâche et celle d'IDLE. Vérifier avec U = C / T pour Stab.
3. La **latence** (de la photo au résultat) est plus longue que le temps d'inférence. Qu'y a-t-il d'autre dedans ?
4. Relever la pile libre de **Vision**. On lui a donné 2048 mots : quelle taille proposeriez-vous ? Pourquoi garder une marge ?
5. Appuyer sur SW2 : la ligne se termine par `,SW2`. Que se passe-t-il pour la photo périodique suivante ?

??? success "Réponses (9.3)"
    1. Le temps mesuré entre `debut` et `duree` est un temps **réel** (« à l'horloge »), pas un temps processeur : si Stab (toutes les 10 ms, 1 ms) préempte Vision pendant l'inférence, cette milliseconde est comptée dedans. D'où environ 1 ms de plus, et une variation selon le nombre de réveils de Stab tombés pendant l'inférence (1 ou 2).
    2. Stab : 1 / 10 = **10 %** (plus le coût de ses réveils). Vision : (copie + conversion + inférence + recherche du meilleur score) / 500 ms, de l'ordre de quelques %. IDLE garde l'essentiel (plus de 80 %) : le système a de la **marge**.
    3. Le temps passé dans la file (si Vision est occupée), la copie de 49 152 octets, la conversion `uint8 → int8` (une boucle sur 49 152 octets), la recherche du meilleur score parmi 1001 classes, et les préemptions par Stab et Camera.
    4. Par exemple, si la pile libre est 1500 mots, Vision n'en a utilisé qu'environ 550 : on peut descendre à 1024 mots. On garde une marge (25 à 50 %) car la mesure ne couvre que les chemins **exécutés** pendant le test, et un débordement est catastrophique.
    5. La photo SW2 est prise tout de suite, en plus. La caméra n'avance son `echeance` que pour les photos périodiques (`appuis == 0`) : la photo périodique suivante a lieu **à l'heure prévue**, le rythme n'est pas décalé.

**9.4 Plusieurs images (facultatif mais conseillé)**

Avec une seule image, le drone voit toujours la même chose. Comme au TP3 (partie 8), convertir plusieurs photos en un fichier `images_data.h` avec `img2c_multi.py`, par exemple :

```
python img2c_multi.py chronometre.jpg tasse.jpg voiture.jpg chat.jpg
```

Copier `images_data.h` dans `source/image/` : le programme le détecte tout seul (`__has_include`) et la caméra fait défiler les images. Choisir les cibles dans `CIBLES[]` parmi les noms de `source/labels.h` (classes ImageNet en anglais : `"stopwatch"`, `"coffee mug"`, `"sports car"`, `"tabby"`…). Chaque image prend 48 Ko de Flash.

**9.5 Expériences : pousser le système à bout**

| N° | Modifier | Observer |
| --- | --- | --- |
| V1 | `PERIODE_CAMERA_MS 100` | CPU de Vision et d'IDLE ? Photos perdues ? |
| V2 | `PERIODE_CAMERA_MS 15` | Photos perdues ? Résultats perdus ? Le moniteur s'affiche-t-il encore ? La LED ? |
| V3 | `PERIODE_CAMERA_MS 500`, `PRIO_VISION 4` et `PRIO_STAB 2` | Échéances ratées et gigue max de Stab ? |
| V4 | Priorités d'origine, `PILE_VISION 200` | Que se passe-t-il ? |

??? success "Réponses (9.5)"
    - **V1.** Cinq fois plus de photos : Vision passe à quelques dizaines de % de CPU, IDLE baisse d'autant, aucune photo perdue. Stab reste à l'heure (gigue inchangée) : Vision est **moins** prioritaire.
    - **V2.** Une photo toutes les 15 ms, alors que Vision met plus de 15 ms par photo (inférence, copie, conversion : comparez avec votre mesure de 9.3) : la file `file_images` est pleine en permanence, `photos perdues` augmente. Il ne reste plus de processeur pour les tâches de priorité 1 : Radio ne vide plus `file_resultats` (résultats perdus, LED figée) et le Moniteur **ne s'affiche plus du tout** : c'est la **famine** (partie 4, C3). Stab, elle, n'a raté aucune échéance. Pour s'en sortir : une période caméra plus longue que le temps de traitement d'une photo, avec de la marge (U < 1).
    - **V3.** Vision est maintenant plus prioritaire que Stab : pendant chaque inférence (plus de 12 ms), Stab ne peut pas s'exécuter alors que sa période est 10 ms. Elle **rate des échéances** à chaque photo et sa gigue dépasse 10 ms. Le réseau de neurones est la tâche **la plus longue**, pas la plus urgente : il doit avoir une priorité **basse**. (Si au contraire rien ne change, c'est que Stab arrive à s'exécuter pendant l'inférence : cela voudrait dire que la bibliothèque du NPU rend le processeur pendant le calcul. Notez ce que vous observez.)
    - **V4.** L'inférence déborde de la pile de Vision dès la première photo : `!!! DEBORDEMENT DE PILE dans la tache Vision !!!`, ou faute matérielle (PSPLIM). Remettre 2048, puis réduire en s'appuyant sur la mesure de la question 9.3.4.

**9.6 Pour aller plus loin (bonus)**

- **Mode rafale** : un appui **long** sur SW2 (plus d'une seconde) fait passer la caméra à une photo toutes les 100 ms pendant 3 s. (Indice : mesurer la durée de l'appui avec deux interruptions, front descendant et front montant.)
- **Alerte** : quand une cible est trouvée 3 fois de suite, une tâche **Alerte** (priorité 3) fait clignoter la LED rouge à 5 Hz pendant 2 s. Quel outil pour la réveiller ?
- **Ton propre modèle** : remplacer MobileNet par le modèle de fleurs du TP2. Attention à la RAM : ce modèle demande une `kTensorArenaSize` plus grande (300 Ko au TP2). Vérifier que le tas FreeRTOS (24 Ko), la pile de `main` (8 Ko) et l'arène tiennent ensemble dans la RAM (fenêtre **Image Info** de MCUXpresso, ou le fichier `.map`).

!!! abstract "À retenir"
    Un système embarqué avec de l'IA, c'est d'abord un **système temps réel** : la tâche d'inférence est longue, on lui donne une priorité **basse** et on la nourrit par une **file** ; les tâches courtes et urgentes (stabilisation) gardent la priorité **haute** et restent à l'heure même quand le réseau calcule. On **mesure** tout : temps d'inférence, latence, charge, gigue, pile. Un seul SysTick : il appartient à FreeRTOS. Pour qu'un système tienne, la charge totale doit rester sous 100 %, avec de la marge.

## Partie 10 — Travail noté : feu tricolore avec bouton piéton

!!! warning "Travail à rendre, noté"
    Cette partie est **évaluée**. Elle vérifie que vous savez réutiliser **seuls** le TD1 (LED RGB, boutons) et les parties 1 à 8 de ce TD : tâches périodiques, priorités, interruption qui réveille une tâche, file, mutex. Il n'y a **pas de corrigé** ici : à vous de concevoir et d'écrire le programme.

On part du projet des **parties 1 à 8** (`TD2_freertos_hello`), en supprimant les tâches du drone (ou dans un nouveau projet `freertos_hello`, en gardant `outils_rtos.c` / `.h` et le `FreeRTOSConfig.h` modifié). On reprend `LED_Init()` et `LED_Couleur()` du **TD1, partie 2**. La LED RGB devient un **feu tricolore** pour les voitures : **vert**, **orange** (rouge + vert, `JAUNE`), **rouge**. Le bouton **SW2** est le **bouton piéton**.

**10.1 Cahier des charges**

| N° | Exigence |
| --- | --- |
| F1 | Cycle normal : **vert 6 s → orange 2 s → rouge 5 s →** vert… Le feu démarre au **rouge**. |
| F2 | À chaque changement d'état, le terminal affiche le temps en ms depuis le démarrage et l'état, par exemple `[ 13000 ms] VERT`. |
| F3 | Un appui sur **SW2** pendant le vert affiche `Demande pieton enregistree` et **raccourcit le vert** : on passe à l'orange sans attendre la fin des 6 s… |
| F4 | … mais le vert dure **au moins 2 s** au total (les voitures doivent pouvoir passer). |
| F5 | Après une demande piéton, le rouge dure **8 s** au lieu de 5 s. Un appui pendant l'orange ou le rouge **ne compte pas**. Un appui ne compte qu'**une** fois, même avec les rebonds. |
| F6 | **Architecture** : une tâche **Feu** (les couleurs et les durées) et une tâche **Bouton**. L'appui sur SW2 est détecté par **interruption** ; l'interruption **réveille** la tâche Bouton (notification, partie 6) ; la tâche Bouton fait l'**anti-rebond** et envoie un événement à la tâche Feu par une **file** (partie 5). **Aucune variable globale** partagée entre tâches, **aucune attente active**. Priorités choisies et justifiées. Tous les affichages passent par `LOG` (mutex, partie 7). |
| Bonus | **Télémétrie** : une troisième tâche affiche toutes les secondes l'état du feu (`[ 4000 ms] TELEM : etat VERT, demande 0`) — comment connaît-elle l'état sans variable partagée non protégée ? **Mode nuit** : un appui sur **SW3** (même interruption `GPIO00_IRQn`) met le feu en **orange clignotant** (1 Hz) ; un nouvel appui revient au cycle normal, **en commençant par le rouge**. |

**10.2 Une machine à états**

Un feu tricolore est une **machine à états** : à chaque instant, il est dans un état (vert, orange, rouge) ; il change d'état au bout d'une durée ou sur un événement (bouton).

```
        6 s (ou SW2, après 2 s minimum)
 VERT ─────────────────────────────────► ORANGE
  ▲                                        │ 2 s
  │       5 s (8 s après une demande)      ▼
  └────────────────────────────────────── ROUGE
```

Point de départ imposé pour la tâche Feu : un `switch` sur l'état courant. Le cas `FEU_VERT` est donné **dans sa version la plus simple** (il ne gère pas encore le bouton) ; tout le reste est à écrire.

```c
#define DUREE_VERT_MS          6000
#define DUREE_VERT_MIN_MS      2000
#define DUREE_ORANGE_MS        2000
#define DUREE_ROUGE_MS         5000
#define DUREE_ROUGE_PIETON_MS  8000

typedef enum { FEU_VERT, FEU_ORANGE, FEU_ROUGE } etat_feu_t;

static void tache_feu(void *pvParameters)
{
    etat_feu_t etat = FEU_ROUGE;

    for (;;)
    {
        switch (etat)
        {
            case FEU_VERT:
                LED_Couleur(VERT);
                LOG("[%6u ms] VERT\r\n", (unsigned)(Temps_us() / 1000U));
                vTaskDelay(pdMS_TO_TICKS(DUREE_VERT_MS));
                etat = FEU_ORANGE;
                break;

            case FEU_ORANGE:
                /* A ecrire */
                break;

            case FEU_ROUGE:
                /* A ecrire */
                break;
        }
    }
}
```

**10.3 Indications**

- Avancez **exigence par exigence** et testez sur la carte après chacune : F1 et F2, puis F3, puis F4, puis F5.
- **Interruption et tâche Bouton** : configurer SW2 comme en partie 6 (`BOUTON_Init`, `NVIC_SetPriority`, `EnableIRQ`). L'interruption ne fait que notifier la tâche Bouton. La tâche Bouton envoie l'événement dans la file, puis ignore les rebonds (partie 6.1).
- **Tâche Feu, pendant le vert** : au lieu d'un seul `vTaskDelay` de 6 s, attendre un événement **dans la file avec un délai maximal** : `xQueueReceive(file, &evt, delai)` renvoie `pdPASS` si un événement arrive avant la fin du délai, `pdFALSE` sinon. Quel délai donner pour respecter F4 ? Que faire d'un appui qui arrive pendant les 2 premières secondes ?
- Pour qu'un appui pendant l'orange ou le rouge soit oublié : que faut-il faire des événements restés dans la file en arrivant au vert ? (Regarder `xQueueReset`.)
- Quelle tâche doit être la plus prioritaire ? Pensez à la règle du TD1 (partie 4.5) et à la partie 6.
- Le moniteur (partie 2) est un bon moyen de vérifier vos priorités et vos piles.

**10.4 Tests à faire et à noter (à rendre)**

| Test | Résultat attendu | Obtenu (copie du terminal) | OK ? |
| --- | --- | --- | --- |
| Aucun appui pendant 30 s | Vert 6 s, orange 2 s, rouge 5 s, en boucle | | |
| SW2 à 1 s de vert | Le vert dure 2 s, puis orange, puis rouge **8 s** | | |
| SW2 à 4 s de vert | Orange tout de suite, puis rouge 8 s | | |
| SW2 pendant le rouge, puis plus rien | Le vert suivant dure 6 s (l'appui est oublié) | | |
| SW2 appuyé 10 fois très vite pendant le vert | Une seule demande enregistrée | | |
| Bonus : SW3 à n'importe quel moment | Orange clignotant ; SW3 à nouveau : retour au rouge | | |

**10.5 Questions (à rendre)**

1. Dessinez la machine à états de **votre** programme (avec le mode nuit si vous l'avez fait) : états, transitions, et ce qui déclenche chaque transition.
2. Pourquoi faut-il démarrer (et revenir du mode nuit) par le **rouge**, plutôt que par le vert ?
3. Quelle est la précision des durées affichées dans le terminal ? D'où vient-elle ?
4. Quelles priorités avez-vous données à vos tâches et à l'interruption ? Que se passerait-il si la tâche Bouton faisait une attente active en étant la plus prioritaire ?
5. Pourquoi une file plutôt qu'une variable `volatile bool demandePieton` partagée ? Donnez un scénario où la variable partagée poserait problème.
6. Comment ajouteriez-vous un **feu piéton** (bonhomme rouge / vert) sur deux autres broches ? Faudrait-il une deuxième tâche ? Justifiez.

**10.6 Ce qu'il faut rendre**

1. Le fichier source **`freertos_hello.c`** complet et commenté, renommé `feu_NOM1_NOM2.c` (avec `outils_rtos.c` / `.h` s'ils ont été modifiés).
2. Un **compte rendu** (PDF, 3 pages maximum) : le tableau de tests rempli avec les copies du terminal, et les réponses aux questions de la partie 10.5.
3. Une **démonstration** sur la carte à l'enseignant (ou une courte vidéo si demandé).

Date limite et modalités de dépôt : celles indiquées par l'enseignant.

**10.7 Barème indicatif (sur 20)**

| Critère | Points |
| --- | --- |
| F1, F2 : cycle normal, durées justes, affichage | 4 |
| F3, F4 : bouton piéton, vert raccourci, vert minimal de 2 s | 5 |
| F5 : rouge allongé, appuis pendant orange / rouge ignorés, anti-rebond | 3 |
| F6 : architecture (interruption → tâche Bouton → file → tâche Feu, priorités justifiées, aucune variable partagée, aucune attente active) | 3 |
| Qualité du code : lisibilité, constantes nommées, commentaires | 2 |
| Compte rendu : tests et réponses aux questions | 3 |
| **Bonus** : tâche télémétrie, mode nuit | +2 |

## Dépannage, synthèse et sources

| Symptôme | Cause probable | Solution |
| --- | --- | --- |
| `undefined reference to Temps_us` ou `Outils_Init` | `outils_rtos.c` pas dans le projet, ou déclarations manquantes dans `FreeRTOSConfig.h` | Vérifier le fichier dans `source/` et la partie 4.1 |
| La colonne CPU reste à 0 | `configGENERATE_RUN_TIME_STATS` encore à 0 | Partie 4.1 |
| `Creation de la tache ... impossible` | Tas FreeRTOS trop petit | Augmenter `configTOTAL_HEAP_SIZE` ou réduire les piles |
| `!!! DEBORDEMENT DE PILE ...` ou arrêt dans `HardFault_Handler` | Pile trop petite, gros tableau local | Agrandir la pile, tableau en `static` (partie 8) |
| Des lignes manquent dans le terminal | Deux tâches écrivent en même temps | Utiliser `LOG` et `Console_Init()` (partie 7) |
| Une attente « de 3 ms » ne dure rien | `pdMS_TO_TICKS(3)` = 0 avec un tick à 200 Hz | Tick à 1000 Hz (partie 1.4) |
| Une tâche de priorité basse ne s'exécute plus | Charge > 100 %, ou une tâche prioritaire ne s'endort jamais | Moniteur : CPU et IDLE (partie 4) |
| Appui sur SW2 sans effet (partie 6 ou 9) | Horloge du port 0 non activée, `EnableIRQ` oublié, ou `extern "C"` manquant en C++ | Parties 6.1 et 9.2 |
| `multiple definition of SysTick_Handler` | `timer.c` de l'exemple eIQ et FreeRTOS | Partie 9.1, étape 5 |
| `Failed initializing model` / `AllocateTensors() failed` | Arène trop petite pour un autre modèle | Agrandir `kTensorArenaSize` dans `model_data.h`, vérifier la RAM |
| Plantages aléatoires après des appuis sur SW2 | Priorité de l'interruption trop haute (0 ou 1) : ce portage ne le vérifie pas | `NVIC_SetPriority(..., 3)` (partie 6.1) |

**Questions de synthèse**

1. Que se passe-t-il, dans l'ordre, entre l'interruption SysTick et le moment où une tâche plus prioritaire reprend son exécution ?
2. Différence entre dérive et gigue ? Laquelle `xTaskDelayUntil` supprime-t-elle ?
3. Trois tâches : (C = 2 ms, T = 10 ms), (C = 10 ms, T = 50 ms), (C = 30 ms, T = 100 ms). Charge totale ? Priorités *Rate Monotonic* ? La borne de Liu et Layland garantit-elle les échéances ?
4. Notification, sémaphore, file, mutex : un exemple d'utilisation de chacun dans le drone VIGIE.
5. Expliquez l'inversion de priorité et la façon dont un mutex l'évite.
6. Dans VIGIE, pourquoi la tâche d'inférence a-t-elle une priorité plus basse que la stabilisation, alors que c'est « la plus importante » pour la mission ?

??? success "Réponses (synthèse)"
    1. SysTick → `xTaskIncrementTick` : le compteur avance, les tâches dont le délai est écoulé passent de bloquées à prêtes → si l'une est plus prioritaire, PendSV est déclenchée → `PendSV_Handler` sauvegarde les registres de la tâche courante sur sa pile, range le sommet de pile dans son TCB, appelle `vTaskSwitchContext` (choix de la tâche prête la plus prioritaire), recharge la pile et les registres de la nouvelle tâche, qui reprend.
    2. Dérive : les retards s'**additionnent** d'une période à l'autre ; gigue : retard **borné** et variable de chaque réveil. `xTaskDelayUntil` supprime la dérive ; la gigue dépend des tâches plus prioritaires.
    3. U = 0,2 + 0,2 + 0,3 = **70 %**. Priorités : T = 10 ms la plus haute, puis 50 ms, puis 100 ms. Borne pour 3 tâches : 78 % ; 70 % ≤ 78 % : les échéances sont **garanties**.
    4. Notification : SW2 réveille la caméra. Sémaphore : on aurait pu l'utiliser à la place de la notification. File : photos Camera → Vision et résultats Vision → Radio. Mutex : la console partagée par Radio et Moniteur.
    5. Une tâche haute attend une ressource tenue par une tâche basse, elle-même préemptée par une tâche moyenne : la haute attend la moyenne. Le mutex donne temporairement à la tâche basse la priorité de la haute (héritage de priorité) : la moyenne ne peut plus la préempter.
    6. La priorité ne mesure pas l'importance pour la mission, mais l'**urgence** : un retard de 15 ms sur une photo n'a pas de conséquence, un retard de 15 ms sur la stabilisation fait tomber le drone. Et une tâche longue placée en haut bloque toutes les autres pendant tout son calcul (expérience V3).

**À vérifier selon votre installation :** ce TD suit les exemples `freertos_hello` et `tflm_label_image` du **SDK FRDM-MCXN947 2.14.0** (FreeRTOS 10.5.1, portage `ARM_CM33_NTZ`, `FreeRTOSConfig.h` du SDK : tick 200 Hz, 5 priorités, tas de 10 Ko, `configUSE_TIME_SLICING 0`, `configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY 2`). Le menu exact pour ajouter FreeRTOS à un projet (partie 9.1) peut varier selon la version de MCUXpresso IDE. Les sorties du terminal sont des prévisions : le code a été compilé et lié avec le SDK, pas encore exécuté sur la carte.

**Sources :** [Exemples MCUXpresso SDK 2.14.0 pour la FRDM-MCXN947](https://github.com/nxp-mcuxpresso/mcux-sdk-examples/tree/MCUX_2.14.0_MCXNx4x/frdmmcxn947) (`freertos_examples`, `eiq_examples/tflm_label_image`) · [Noyau FreeRTOS du SDK (branche MCUX\_2.14.0\_MCXNx4x)](https://github.com/nxp-mcuxpresso/FreeRTOS-Kernel/tree/MCUX_2.14.0_MCXNx4x) · [Documentation FreeRTOS : tâches, files, sémaphores, notifications](https://www.freertos.org/Documentation/02-Kernel/02-Kernel-features/00-Developer-docs) · [FreeRTOS : statistiques d'exécution](https://www.freertos.org/Documentation/02-Kernel/02-Kernel-features/08-Run-time-statistics) · C. L. Liu et J. W. Layland, *Scheduling Algorithms for Multiprogramming in a Hard-Real-Time Environment*, Journal of the ACM, 1973 · G. Reeves, *What really happened on Mars?* (1997), récit de l'inversion de priorité de Mars Pathfinder.
