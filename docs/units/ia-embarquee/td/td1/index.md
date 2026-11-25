# TD1 : Prise en main de la FRDM-MCXN947 — LED, bouton, FreeRTOS et feu tricolore


## Objectifs, prérequis et déroulé

Dans ce TD, on découvre la carte NXP **FRDM-MCXN947** en programmant ses entrées et sorties. On ne part jamais d'une page blanche : chaque étape commence par un **exemple du SDK** qui fonctionne déjà, qu'on compile, qu'on lit, puis qu'on **enrichit pas à pas**. À la fin, vous programmez un **feu tricolore avec bouton piéton** sous FreeRTOS.

| Étape | Exemple du SDK de départ | Ce qu'on ajoute |
| --- | --- | --- |
| 1 | `gpio_led_output` | Lire le code, changer la vitesse de clignotement |
| 2 | (le même) | Les trois couleurs de la LED RGB et leurs mélanges |
| 3 | `gpio_input_interrupt` | Les boutons SW2 et SW3 par interruption, l'anti-rebond |
| 4 | `freertos_hello` | Des tâches FreeRTOS, `vTaskDelay`, un sémaphore donné par le bouton |
| Projet | (le projet de l'étape 4) | Un feu tricolore : machine à états, bouton piéton, mode nuit |

**Matériel**

- Carte NXP FRDM-MCXN947, câble USB-C sur le connecteur **MCU-Link (J17)**.

**Logiciel**

- MCUXpresso IDE et le **SDK FRDM-MCXN947 2.14.0** (avec le composant **FreeRTOS**, coché par défaut dans le SDK Builder).
- Un terminal série : celui de MCUXpresso IDE suffit (**115200 bauds, 8 bits, pas de parité, 1 bit de stop**).

**Durée :** environ 3 h (étapes 1 à 4 : 1 h 30, projet : 1 h 30).

## Partie 0 — La carte et ses broches

Le microcontrôleur **MCX N947** (deux cœurs Arm Cortex-M33 à 150 MHz, 2 Mo de Flash, jusqu'à 512 Ko de RAM) est au centre de la carte. Autour de lui, ce qui nous intéresse aujourd'hui :

| Élément | Broche | Module GPIO | Nom dans `board.h` | Remarque |
| --- | --- | --- | --- | --- |
| LED rouge | P0\_10 | GPIO0, broche 10 | `BOARD_LED_RED_GPIO`, `BOARD_LED_RED_GPIO_PIN` | Active à l'état **bas** |
| LED verte | P0\_27 | GPIO0, broche 27 | `BOARD_LED_GREEN_GPIO`, `..._PIN` | Active à l'état **bas** |
| LED bleue | P1\_2 | GPIO**1**, broche 2 | `BOARD_LED_BLUE_GPIO`, `..._PIN` | Active à l'état **bas**, sur le port 1 |
| Bouton SW2 | P0\_23 | GPIO0, broche 23 | `BOARD_SW2_GPIO`, `BOARD_SW2_GPIO_PIN` | Vaut 1 au repos, 0 appuyé |
| Bouton SW3 | P0\_6 | GPIO0, broche 6 | `BOARD_SW3_GPIO`, `BOARD_SW3_GPIO_PIN` | Vaut 1 au repos, 0 appuyé |
| Interruption des boutons | | | `BOARD_SW2_IRQ` = `BOARD_SW3_IRQ` = `GPIO00_IRQn` | **Une seule** interruption pour tout le port 0 |
| Bouton RESET | | | | Redémarre le programme |

Les trois LED sont en fait **une seule LED RGB** : trois petites diodes (rouge, verte, bleue) dans le même boîtier. En allumant plusieurs couleurs à la fois, on obtient des mélanges (rouge + vert = jaune).

**Active à l'état bas.** La LED est branchée entre l'alimentation et la broche. Elle s'allume quand la broche est à **0** et s'éteint quand elle est à **1**. C'est pour cela que `board.h` définit `LOGIC_LED_ON 0U` et `LOGIC_LED_OFF 1U`.

**Trois choses à régler pour utiliser une broche**

1. **L'horloge** du module : sans horloge, un périphérique ne fonctionne pas (`CLOCK_EnableClock(kCLOCK_Gpio0)`, `kCLOCK_Port0`…).
2. **Le PORT** : il choisit la *fonction* de la broche (GPIO, UART, PWM…) et ses réglages électriques (résistance de tirage, entrée numérique). C'est le rôle du fichier `board/pin_mux.c`.
3. **Le GPIO** : il choisit le *sens* (entrée ou sortie), puis lit ou écrit la valeur (`GPIO_PinInit`, `GPIO_PinWrite`, `GPIO_PinRead`).

## Partie 1 — Faire clignoter la LED rouge (exemple gpio\_led\_output)

**1.1 Importer l'exemple**

1. Menu **File → New → Import SDK example(s)…**, choisir la carte **frdmmcxn947**, puis **Next**.
2. **Project name prefix** : `TD1_`. **SDK Debug Console** : **UART**.
3. Déplier **driver\_examples → gpio** et cocher **gpio\_led\_output**. **Finish**.

**1.2 Compiler, flasher, lancer**

1. **Build** (marteau). La console doit finir par `0 errors`.
2. Brancher la carte sur **J17**. **Debug** → choisir la sonde **MCU-LINK** → le programme s'arrête sur `main()` → **Resume** (F8).
3. Ouvrir le terminal série (onglet **Terminal**, *Serial Terminal*, 115200 bauds). Appuyer sur **RESET** si rien ne s'affiche.

**Checkpoint :** la LED clignote en **rouge** et le terminal affiche `GPIO Driver example` puis `The LED is blinking.`

**1.3 Lire le code**

Ouvrir `source/gpio_led_output.c`. L'essentiel tient en quelques lignes :

```c
#define BOARD_LED_GPIO     BOARD_LED_RED_GPIO       // GPIO0
#define BOARD_LED_GPIO_PIN BOARD_LED_RED_GPIO_PIN   // 10

void delay(void)
{
    volatile uint32_t i = 0;
    for (i = 0; i < 800000; ++i) { __asm("NOP"); }  // attente "a la main"
}

int main(void)
{
    gpio_pin_config_t led_config = {kGPIO_DigitalOutput, 0};   // sortie, valeur 0
    ...
    CLOCK_EnableClock(kCLOCK_Gpio0);      // horloge du GPIO0
    BOARD_InitPins();                     // pin_mux.c : P0_10 en GPIO
    BOARD_InitBootClocks();
    BOARD_InitDebugConsole();             // liaison serie pour PRINTF
    ...
    GPIO_PinInit(BOARD_LED_GPIO, BOARD_LED_GPIO_PIN, &led_config);
    while (1)
    {
        delay();
        GPIO_PortToggle(BOARD_LED_GPIO, 1u << BOARD_LED_GPIO_PIN);  // inverse la broche
    }
}
```

**Astuce :** **Ctrl + clic** sur un nom (`BOARD_LED_RED_GPIO`, `GPIO_PortToggle`…) ouvre l'endroit où il est défini.

**Questions**

1. `GPIO_PortToggle` reçoit `1u << 10`. Que représente ce nombre ? Pourquoi un décalage et pas simplement `10` ?
2. Au démarrage, `led_config` met la broche à 0. La LED est-elle allumée ou éteinte avant le premier `delay()` ? Pourquoi ?
3. Remplacer `800000` par `200000`. Que se passe-t-il ? Chronométrez 10 clignotements et estimez la durée d'un `delay()`.
4. Pourquoi cette façon d'attendre est-elle imprécise ? (Pensez à la fréquence du processeur et aux options d'optimisation du compilateur.)
5. Ouvrir `board/pin_mux.c`. Quelles broches sont configurées par `BOARD_InitPins()` ? Remplacer `BOARD_LED_RED_GPIO` par `BOARD_LED_BLUE_GPIO` (et le `_PIN`) : que manque-t-il pour que la LED bleue fonctionne ? (Indice : regarder son port et son module GPIO dans le tableau de la partie 0.)

Remettre la LED rouge avant de passer à la suite.

## Partie 2 — Les trois couleurs de la LED RGB

On garde le projet `gpio_led_output` et on l'enrichit : on configure les **trois** LED, puis on écrit une fonction qui affiche une couleur.

**2.1 Configurer les trois LED**

Ajouter `#include "fsl_port.h"` sous les autres `#include`, puis, avant `main()` :

```c
/* LED rouge P0_10, verte P0_27, bleue P1_2 : on les configure toutes en sortie */
static void LED_Init(void)
{
    gpio_pin_config_t sortie = {kGPIO_DigitalOutput, 1}; /* 1 = LED eteinte */

    CLOCK_EnableClock(kCLOCK_Port0); /* horloges des ports 0 et 1 ... */
    CLOCK_EnableClock(kCLOCK_Port1);
    CLOCK_EnableClock(kCLOCK_Gpio0); /* ... et des modules GPIO 0 et 1 */
    CLOCK_EnableClock(kCLOCK_Gpio1);

    PORT_SetPinMux(PORT0, BOARD_LED_RED_GPIO_PIN, kPORT_MuxAlt0); /* fonction GPIO */
    PORT_SetPinMux(PORT0, BOARD_LED_GREEN_GPIO_PIN, kPORT_MuxAlt0);
    PORT_SetPinMux(PORT1, BOARD_LED_BLUE_GPIO_PIN, kPORT_MuxAlt0);

    GPIO_PinInit(BOARD_LED_RED_GPIO, BOARD_LED_RED_GPIO_PIN, &sortie);
    GPIO_PinInit(BOARD_LED_GREEN_GPIO, BOARD_LED_GREEN_GPIO_PIN, &sortie);
    GPIO_PinInit(BOARD_LED_BLUE_GPIO, BOARD_LED_BLUE_GPIO_PIN, &sortie);
}
```

`kPORT_MuxAlt0` est la fonction n° 0 de la broche, c'est-à-dire **GPIO**. La LED bleue est sur le **port 1** : il faut donc aussi les horloges `kCLOCK_Port1` et `kCLOCK_Gpio1` (c'était la réponse à la question 1.5).

**2.2 Une fonction « couleur »**

On code une couleur sur 3 bits : rouge = 1, vert = 2, bleu = 4. Pour mélanger, on additionne.

```c
#define NOIR    0
#define ROUGE   1
#define VERT    2
#define JAUNE   3 /* rouge + vert */
#define BLEU    4
#define MAGENTA 5 /* rouge + bleu */
#define CYAN    6 /* vert + bleu */
#define BLANC   7 /* rouge + vert + bleu */

/* Allume la LED dans la couleur demandee. LED active a l'etat bas : 0 = allumee. */
static void LED_Couleur(int couleur)
{
    GPIO_PinWrite(BOARD_LED_RED_GPIO, BOARD_LED_RED_GPIO_PIN, (couleur & ROUGE) ? 0 : 1);
    GPIO_PinWrite(BOARD_LED_GREEN_GPIO, BOARD_LED_GREEN_GPIO_PIN, (couleur & VERT) ? 0 : 1);
    GPIO_PinWrite(BOARD_LED_BLUE_GPIO, BOARD_LED_BLUE_GPIO_PIN, (couleur & BLEU) ? 0 : 1);
}
```

`couleur & VERT` teste le bit du vert : par exemple `JAUNE & VERT` = `3 & 2` = 2 (vrai), donc la LED verte s'allume.

**2.3 Rouge, vert, bleu**

Dans `main()`, supprimer `GPIO_PinInit(...)` et la boucle `while (1)`, et les remplacer par :

```c
    LED_Init();
    const int sequence[]     = {ROUGE, VERT, BLEU};
    const char *const noms[] = {"rouge", "vert", "bleu"};

    while (1)
    {
        for (int i = 0; i < 3; i++)
        {
            LED_Couleur(sequence[i]);
            PRINTF("LED %s\r\n", noms[i]);
            SDK_DelayAtLeastUs(500000U, SystemCoreClock); /* 500 ms */
        }
    }
```

`SDK_DelayAtLeastUs` (du SDK) attend une durée donnée en microsecondes, quelle que soit la fréquence du processeur : c'est plus précis que la boucle `delay()`.

**Checkpoint :** **Build**, **Debug**, **Resume** : la LED passe rouge → vert → bleu toutes les 500 ms et le terminal affiche `LED rouge`, `LED vert`, `LED bleu`.

??? note "Fichier `gpio_led_output.c` complet de l'étape 2"

    ```c
    /* gpio_led_output.c (TD1, etape 2) : les couleurs de la LED RGB */
    #include "pin_mux.h"
    #include "clock_config.h"
    #include "board.h"
    #include "fsl_debug_console.h"
    #include "fsl_gpio.h"
    #include "fsl_port.h"

    /* Une couleur = 3 bits : rouge (1), vert (2), bleu (4). On les additionne pour melanger. */
    #define NOIR    0
    #define ROUGE   1
    #define VERT    2
    #define JAUNE   3 /* rouge + vert */
    #define BLEU    4
    #define MAGENTA 5 /* rouge + bleu */
    #define CYAN    6 /* vert + bleu */
    #define BLANC   7 /* rouge + vert + bleu */

    /* LED rouge P0_10, verte P0_27, bleue P1_2 : on les configure toutes en sortie */
    static void LED_Init(void)
    {
        gpio_pin_config_t sortie = {kGPIO_DigitalOutput, 1}; /* 1 = LED eteinte */

        CLOCK_EnableClock(kCLOCK_Port0); /* horloges des ports 0 et 1 ... */
        CLOCK_EnableClock(kCLOCK_Port1);
        CLOCK_EnableClock(kCLOCK_Gpio0); /* ... et des modules GPIO 0 et 1 */
        CLOCK_EnableClock(kCLOCK_Gpio1);

        PORT_SetPinMux(PORT0, BOARD_LED_RED_GPIO_PIN, kPORT_MuxAlt0); /* fonction GPIO */
        PORT_SetPinMux(PORT0, BOARD_LED_GREEN_GPIO_PIN, kPORT_MuxAlt0);
        PORT_SetPinMux(PORT1, BOARD_LED_BLUE_GPIO_PIN, kPORT_MuxAlt0);

        GPIO_PinInit(BOARD_LED_RED_GPIO, BOARD_LED_RED_GPIO_PIN, &sortie);
        GPIO_PinInit(BOARD_LED_GREEN_GPIO, BOARD_LED_GREEN_GPIO_PIN, &sortie);
        GPIO_PinInit(BOARD_LED_BLUE_GPIO, BOARD_LED_BLUE_GPIO_PIN, &sortie);
    }

    /* Allume la LED dans la couleur demandee. LED active a l'etat bas : 0 = allumee. */
    static void LED_Couleur(int couleur)
    {
        GPIO_PinWrite(BOARD_LED_RED_GPIO, BOARD_LED_RED_GPIO_PIN, (couleur & ROUGE) ? 0 : 1);
        GPIO_PinWrite(BOARD_LED_GREEN_GPIO, BOARD_LED_GREEN_GPIO_PIN, (couleur & VERT) ? 0 : 1);
        GPIO_PinWrite(BOARD_LED_BLUE_GPIO, BOARD_LED_BLUE_GPIO_PIN, (couleur & BLEU) ? 0 : 1);
    }

    int main(void)
    {
        const int sequence[]      = {ROUGE, VERT, BLEU};
        const char *const noms[]  = {"rouge", "vert", "bleu"};

        /* attach FRO 12M to FLEXCOMM4 (debug console) */
        CLOCK_SetClkDiv(kCLOCK_DivFlexcom4Clk, 1u);
        CLOCK_AttachClk(BOARD_DEBUG_UART_CLK_ATTACH);
        BOARD_InitPins();
        BOARD_InitBootClocks();
        BOARD_InitDebugConsole();

        PRINTF("\r\nTD1 - etape 2 : les couleurs de la LED RGB\r\n");
        LED_Init();

        while (1)
        {
            for (int i = 0; i < 3; i++)
            {
                LED_Couleur(sequence[i]);
                PRINTF("LED %s\r\n", noms[i]);
                SDK_DelayAtLeastUs(500000U, SystemCoreClock); /* 500 ms */
            }
        }
    }
    ```

**À vous**

1. Modifier la séquence pour afficher les **8 couleurs** de `NOIR` à `BLANC`, avec leur nom dans le terminal.
2. Le jaune obtenu ressemble-t-il à du jaune ? Et à de l'orange ? Pourquoi est-ce difficile d'obtenir un vrai orange en allumant simplement les LED rouge et verte ? (Indice : il faudrait régler la *luminosité* de chaque LED, avec un signal PWM.)
3. Écrire une fonction `LED_Clignoter(int couleur, int nb, int periode_ms)` qui fait clignoter `nb` fois une couleur. L'utiliser pour faire clignoter 3 fois le magenta au démarrage.

## Partie 3 — Réagir aux boutons (exemple gpio\_input\_interrupt)

**3.1 Importer et essayer l'exemple**

1. **Import SDK example(s)** → **driver\_examples → gpio → gpio\_input\_interrupt**, même préfixe `TD1_`.
2. **Build**, **Debug**, **Resume**. Le terminal affiche `Press SW3 to turn on/off a LED`.
3. Appuyer sur **SW3** : la LED rouge s'allume ou s'éteint, et le terminal affiche `SW3 is pressed`.

**3.2 Lire le code**

```c
volatile bool g_ButtonPress = false;

void BOARD_SW_IRQ_HANDLER(void)          // = GPIO00_IRQHandler : appelee par le materiel
{
    GPIO_GpioClearInterruptFlags(BOARD_SW_GPIO, 1U << BOARD_SW_GPIO_PIN); // acquitter
    g_ButtonPress = true;                // on note l'appui, c'est tout
    SDK_ISR_EXIT_BARRIER;
}

int main(void)
{
    ...
    GPIO_SetPinInterruptConfig(BOARD_SW_GPIO, BOARD_SW_GPIO_PIN, kGPIO_InterruptFallingEdge);
    EnableIRQ(BOARD_SW_IRQ);
    GPIO_PinInit(BOARD_SW_GPIO, BOARD_SW_GPIO_PIN, &sw_config);
    ...
    while (1)
    {
        if (g_ButtonPress)
        {
            PRINTF(" %s is pressed \r\n", BOARD_SW_NAME);
            GPIO_PortToggle(BOARD_LED_GPIO, 1U << BOARD_LED_GPIO_PIN);
            g_ButtonPress = false;
        }
    }
}
```

Le code contient aussi une variante `#if ... PORT_SetPinInterruptConfig ...` pour d'autres microcontrôleurs : sur le MCX N947, ce sont les fonctions `GPIO_...` qui sont compilées, car les interruptions sont gérées par le module GPIO et non par le PORT.

**Questions**

1. Que veut dire `kGPIO_InterruptFallingEdge` ? Pourquoi un **front descendant** correspond-il à un appui ? (Regarder la partie 0.)
2. Pourquoi la variable `g_ButtonPress` est-elle déclarée `volatile` ?
3. Pourquoi le `PRINTF` est-il dans la boucle principale et pas dans la fonction d'interruption ?
4. Que se passerait-il si on oubliait d'acquitter l'interruption (`GPIO_GpioClearInterruptFlags`) ?
5. Quelle différence entre cette méthode et une lecture en boucle de `GPIO_PinRead` (scrutation, ou *polling*) ?

**3.3 Enrichir : SW3 = couleur suivante, SW2 = couleur précédente**

On reprend `LED_Init()` et `LED_Couleur()` de l'étape 2 (et les `#define` des couleurs), et on ajoute le bouton **SW2**. Les deux boutons sont sur le port 0 : ils partagent **la même** interruption `GPIO00_IRQn`. La fonction d'interruption doit donc regarder **quel** bouton l'a déclenchée.

1. Une fonction pour configurer un bouton du port 0 :

```c
/* Bouton sur le port 0 : entree avec tirage vers le haut, interruption sur front descendant */
static void BOUTON_Init(uint32_t pin)
{
    gpio_pin_config_t entree = {kGPIO_DigitalInput, 0};

    /* GPIO (MUX 0) + entree numerique activee (IBE) + tirage vers le haut (PE + PS) */
    PORT0->PCR[pin] = PORT_PCR_MUX(0) | PORT_PCR_IBE_MASK | PORT_PCR_PE_MASK | PORT_PCR_PS_MASK;
    GPIO_SetPinInterruptConfig(GPIO0, pin, kGPIO_InterruptFallingEdge);
    GPIO_PinInit(GPIO0, pin, &entree);
}
```

2. Remplacer la variable et la fonction d'interruption par :

```c
volatile bool g_appuiSW2 = false;
volatile bool g_appuiSW3 = false;

/* SW2 et SW3 sont sur le meme port : une seule interruption, on regarde qui l'a declenchee */
void GPIO00_IRQHandler(void)
{
    uint32_t flags = GPIO_GpioGetInterruptFlags(GPIO0);

    GPIO_GpioClearInterruptFlags(GPIO0, flags);
    if (flags & (1U << BOARD_SW2_GPIO_PIN))
        g_appuiSW2 = true;
    if (flags & (1U << BOARD_SW3_GPIO_PIN))
        g_appuiSW3 = true;
    SDK_ISR_EXIT_BARRIER;
}
```

3. Dans `main()`, après `BOARD_InitDebugConsole()`, remplacer la configuration du bouton et de la LED, et la boucle, par :

```c
    LED_Init();
    BOUTON_Init(BOARD_SW2_GPIO_PIN);
    BOUTON_Init(BOARD_SW3_GPIO_PIN);
    EnableIRQ(BOARD_SW3_IRQ);            /* GPIO00_IRQn, commune a SW2 et SW3 */
    LED_Couleur(couleur);                /* declarer avant : int couleur = ROUGE; */

    while (1)
    {
        if (g_appuiSW3 || g_appuiSW2)
        {
            if (g_appuiSW3)
                couleur = (couleur + 1) % 8;     /* 7 -> 0 */
            else
                couleur = (couleur + 7) % 8;     /* 0 -> 7 */
            LED_Couleur(couleur);
            PRINTF("Couleur %d : %s\r\n", couleur, noms[couleur]);

            SDK_DelayAtLeastUs(50000U, SystemCoreClock); /* anti-rebond : 50 ms */
            g_appuiSW2 = false;                          /* on oublie les rebonds */
            g_appuiSW3 = false;
        }
    }
```

avec, au début de `main()` :

```c
    const char *const noms[] = {"noir", "rouge", "vert", "jaune", "bleu", "magenta", "cyan", "blanc"};
    int couleur = ROUGE;
```

**Checkpoint :** chaque appui sur **SW3** passe à la couleur suivante, chaque appui sur **SW2** revient à la précédente, et le terminal affiche le numéro et le nom de la couleur.

??? note "Fichier `gpio_input_interrupt.c` complet de l'étape 3"

    ```c
    /* gpio_input_interrupt.c (TD1, etape 3) : SW3 = couleur suivante, SW2 = couleur precedente */
    #include "fsl_debug_console.h"
    #include "fsl_port.h"
    #include "fsl_gpio.h"
    #include "fsl_common.h"
    #include "pin_mux.h"
    #include "clock_config.h"
    #include "board.h"

    #define NOIR    0
    #define ROUGE   1
    #define VERT    2
    #define JAUNE   3
    #define BLEU    4
    #define MAGENTA 5
    #define CYAN    6
    #define BLANC   7

    /* LED_Init() et LED_Couleur() : copiees de l'etape 2 */
    static void LED_Init(void)
    {
        gpio_pin_config_t sortie = {kGPIO_DigitalOutput, 1};
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

    /* Bouton sur le port 0 : entree avec tirage vers le haut, interruption sur front descendant */
    static void BOUTON_Init(uint32_t pin)
    {
        gpio_pin_config_t entree = {kGPIO_DigitalInput, 0};

        /* GPIO (MUX 0) + entree numerique activee (IBE) + tirage vers le haut (PE + PS) */
        PORT0->PCR[pin] = PORT_PCR_MUX(0) | PORT_PCR_IBE_MASK | PORT_PCR_PE_MASK | PORT_PCR_PS_MASK;
        GPIO_SetPinInterruptConfig(GPIO0, pin, kGPIO_InterruptFallingEdge);
        GPIO_PinInit(GPIO0, pin, &entree);
    }

    volatile bool g_appuiSW2 = false;
    volatile bool g_appuiSW3 = false;

    /* SW2 et SW3 sont sur le meme port : une seule interruption, on regarde qui l'a declenchee */
    void GPIO00_IRQHandler(void)
    {
        uint32_t flags = GPIO_GpioGetInterruptFlags(GPIO0);

        GPIO_GpioClearInterruptFlags(GPIO0, flags);
        if (flags & (1U << BOARD_SW2_GPIO_PIN))
            g_appuiSW2 = true;
        if (flags & (1U << BOARD_SW3_GPIO_PIN))
            g_appuiSW3 = true;
        SDK_ISR_EXIT_BARRIER;
    }

    int main(void)
    {
        const char *const noms[] = {"noir", "rouge", "vert", "jaune", "bleu", "magenta", "cyan", "blanc"};
        int couleur = ROUGE;

        /* attach FRO 12M to FLEXCOMM4 (debug console) */
        CLOCK_SetClkDiv(kCLOCK_DivFlexcom4Clk, 1u);
        CLOCK_AttachClk(BOARD_DEBUG_UART_CLK_ATTACH);
        CLOCK_EnableClock(kCLOCK_Gpio0);
        BOARD_InitPins();
        BOARD_InitBootClocks();
        BOARD_InitDebugConsole();

        PRINTF("\r\nTD1 - etape 3 : SW3 = couleur suivante, SW2 = couleur precedente\r\n");
        LED_Init();
        BOUTON_Init(BOARD_SW2_GPIO_PIN);
        BOUTON_Init(BOARD_SW3_GPIO_PIN);
        EnableIRQ(BOARD_SW3_IRQ); /* GPIO00_IRQn, commune a SW2 et SW3 */
        LED_Couleur(couleur);

        while (1)
        {
            if (g_appuiSW3 || g_appuiSW2)
            {
                if (g_appuiSW3)
                    couleur = (couleur + 1) % 8;     /* 7 -> 0 */
                else
                    couleur = (couleur + 7) % 8;     /* 0 -> 7 */
                LED_Couleur(couleur);
                PRINTF("Couleur %d : %s\r\n", couleur, noms[couleur]);

                SDK_DelayAtLeastUs(50000U, SystemCoreClock); /* anti-rebond : 50 ms */
                g_appuiSW2 = false;                          /* on oublie les rebonds */
                g_appuiSW3 = false;
            }
        }
    }
    ```

**Pourquoi `IBE` et le tirage vers le haut ?** Pour une **entrée**, il faut activer le tampon d'entrée numérique (`IBE`), sinon la broche se lit toujours 0. La résistance de tirage vers le haut (`PE` + `PS`) donne un 1 stable quand le bouton est relâché ; l'appui relie la broche à la masse (0).

**Questions**

1. Retirer l'anti-rebond (la ligne `SDK_DelayAtLeastUs` et les deux remises à `false`). Appuyer plusieurs fois : arrive-t-il qu'une couleur soit sautée ? Expliquez ce qu'est un **rebond**.
2. Pourquoi `(couleur + 7) % 8` et pas `(couleur - 1) % 8` ? (Calculer les deux pour `couleur = 0`.)
3. Pendant que le programme attend un appui, que fait le processeur ? Est-ce économe en énergie ?

## Partie 4 — Passer sous FreeRTOS (exemple freertos\_hello)

Jusqu'ici, tout se passe dans une seule boucle `while (1)`. Dès qu'on veut faire **plusieurs choses en même temps** (clignoter, surveiller un bouton, afficher…), cette boucle devient difficile à écrire. Un **système d'exploitation temps réel** (RTOS) comme **FreeRTOS** permet de découper le programme en **tâches** indépendantes, chacune avec sa propre boucle. L'**ordonnanceur** de FreeRTOS partage le processeur entre elles.

**4.1 Importer et essayer l'exemple**

1. **Import SDK example(s)** → **rtos\_examples** (ou **freertos\_examples** selon l'IDE) → **freertos\_hello**, préfixe `TD1_`.
2. **Build**, **Debug**, **Resume**. Le terminal affiche une fois `Hello world.`

**4.2 Lire le code**

```c
#define hello_task_PRIORITY (configMAX_PRIORITIES - 1)

int main(void)
{
    ...  /* initialisation de la carte, comme avant */
    if (xTaskCreate(hello_task, "Hello_task", configMINIMAL_STACK_SIZE + 100, NULL,
                    hello_task_PRIORITY, NULL) != pdPASS)
    { PRINTF("Task creation failed!.\r\n"); while (1); }
    vTaskStartScheduler();   /* FreeRTOS prend la main : ne revient jamais */
    for (;;);
}

static void hello_task(void *pvParameters)
{
    for (;;)
    {
        PRINTF("Hello world.\r\n");
        vTaskSuspend(NULL);  /* la tache se suspend elle-meme : un seul message */
    }
}
```

`xTaskCreate` reçoit : la fonction de la tâche, son nom, la taille de sa **pile** (en mots de 4 octets), un paramètre, sa **priorité** (0 à `configMAX_PRIORITIES - 1`, ici 0 à 4) et un pointeur pour récupérer son identifiant.

Ouvrir `source/FreeRTOSConfig.h` et relever : `configTICK_RATE_HZ` (fréquence du *tick*, l'horloge de FreeRTOS), `configMAX_PRIORITIES` et `configTOTAL_HEAP_SIZE` (mémoire réservée aux tâches).

**Questions**

1. Remplacer `vTaskSuspend(NULL);` par `vTaskDelay(pdMS_TO_TICKS(1000));`. Que se passe-t-il ?
2. Avec `configTICK_RATE_HZ` = 200, combien de ticks dure `pdMS_TO_TICKS(1000)` ? Quelle est la plus petite attente possible ?

**4.3 Enrichir : trois tâches**

On écrit trois tâches : la première fait clignoter le **rouge** toutes les 500 ms, la deuxième le **bleu** toutes les 300 ms, la troisième **attend le bouton SW2** et bascule le **vert**.

Pour la troisième, on n'utilise plus une variable `volatile` comme en partie 3, mais un **sémaphore** : l'interruption le *donne* (`xSemaphoreGiveFromISR`), la tâche le *prend* (`xSemaphoreTake`). Tant qu'il n'y a pas d'appui, la tâche est **bloquée** et ne consomme pas de temps processeur.

1. En haut du fichier, ajouter `#include "semphr.h"`, `#include "fsl_port.h"` et `#include "fsl_gpio.h"`, puis copier les `#define` des couleurs, `LED_Init()` et `BOUTON_Init()` de la partie 3.
2. Ajouter le sémaphore, l'interruption et les tâches :

```c
static SemaphoreHandle_t s_semSW2; /* "donne" par l'interruption, "pris" par la tache bouton */

void GPIO00_IRQHandler(void)
{
    BaseType_t reveil = pdFALSE;
    uint32_t flags    = GPIO_GpioGetInterruptFlags(GPIO0);

    GPIO_GpioClearInterruptFlags(GPIO0, flags);
    if (flags & (1U << BOARD_SW2_GPIO_PIN))
        xSemaphoreGiveFromISR(s_semSW2, &reveil);
    portYIELD_FROM_ISR(reveil); /* si la tache bouton est plus prioritaire, elle passe tout de suite */
}

/* Tache 1 : fait clignoter le rouge toutes les 500 ms */
static void tache_rouge(void *pvParameters)
{
    for (;;)
    {
        LED_RED_TOGGLE();
        vTaskDelay(pdMS_TO_TICKS(500)); /* la tache dort : le processeur est libre pour les autres */
    }
}

/* Tache 2 : fait clignoter le bleu toutes les 300 ms */
static void tache_bleue(void *pvParameters)
{
    for (;;)
    {
        LED_BLUE_TOGGLE();
        vTaskDelay(pdMS_TO_TICKS(300));
    }
}

/* Tache 3 : attend SW2 (sans consommer de temps processeur) et bascule le vert */
static void tache_bouton(void *pvParameters)
{
    int nbAppuis = 0;
    for (;;)
    {
        xSemaphoreTake(s_semSW2, portMAX_DELAY); /* bloquee jusqu'au prochain appui */
        LED_GREEN_TOGGLE();
        PRINTF("SW2 appuye (%d fois)\r\n", ++nbAppuis);
        vTaskDelay(pdMS_TO_TICKS(50));           /* anti-rebond */
        xSemaphoreTake(s_semSW2, 0);             /* oublie un rebond eventuel */
    }
}
```

3. Remplacer `main()` (et supprimer `hello_task`) :

```c
int main(void)
{
    /* attach FRO 12M to FLEXCOMM4 (debug console) */
    CLOCK_SetClkDiv(kCLOCK_DivFlexcom4Clk, 1u);
    CLOCK_AttachClk(BOARD_DEBUG_UART_CLK_ATTACH);
    BOARD_InitPins();
    BOARD_InitBootClocks();
    BOARD_InitDebugConsole();

    LED_Init();
    BOUTON_Init(BOARD_SW2_GPIO_PIN);
    s_semSW2 = xSemaphoreCreateBinary();

    /* Une interruption qui appelle FreeRTOS (...FromISR) doit avoir une priorite
       >= configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY (0 = la plus haute, interdite ici) */
    NVIC_SetPriority(BOARD_SW2_IRQ, configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY);
    EnableIRQ(BOARD_SW2_IRQ);

    PRINTF("\r\nTD1 - etape 4 : 3 taches FreeRTOS\r\n");
    xTaskCreate(tache_rouge, "Rouge", configMINIMAL_STACK_SIZE + 100, NULL, 1, NULL);
    xTaskCreate(tache_bleue, "Bleue", configMINIMAL_STACK_SIZE + 100, NULL, 1, NULL);
    xTaskCreate(tache_bouton, "Bouton", configMINIMAL_STACK_SIZE + 200, NULL, 2, NULL);
    vTaskStartScheduler(); /* ne revient jamais : FreeRTOS prend la main */
    for (;;)
        ;
}
```

**Checkpoint :** le rouge et le bleu clignotent chacun à leur rythme (la LED change de couleur : rouge, bleu, magenta, éteinte…). Chaque appui sur **SW2** ajoute ou retire le vert et affiche `SW2 appuye (n fois)`.

??? note "Fichier `freertos_hello.c` complet de l'étape 4"

    ```c
    /* freertos_hello.c (TD1, etape 4) : trois taches FreeRTOS */
    #include "FreeRTOS.h"
    #include "task.h"
    #include "semphr.h"
    #include "fsl_debug_console.h"
    #include "fsl_port.h"
    #include "fsl_gpio.h"
    #include "pin_mux.h"
    #include "clock_config.h"
    #include "board.h"

    #define NOIR    0
    #define ROUGE   1
    #define VERT    2
    #define JAUNE   3
    #define BLEU    4
    #define MAGENTA 5
    #define CYAN    6
    #define BLANC   7

    static void LED_Init(void)
    {
        gpio_pin_config_t sortie = {kGPIO_DigitalOutput, 1};
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
    static void BOUTON_Init(uint32_t pin)
    {
        gpio_pin_config_t entree = {kGPIO_DigitalInput, 0};
        PORT0->PCR[pin] = PORT_PCR_MUX(0) | PORT_PCR_IBE_MASK | PORT_PCR_PE_MASK | PORT_PCR_PS_MASK;
        GPIO_SetPinInterruptConfig(GPIO0, pin, kGPIO_InterruptFallingEdge);
        GPIO_PinInit(GPIO0, pin, &entree);
    }

    static SemaphoreHandle_t s_semSW2; /* "donne" par l'interruption, "pris" par la tache bouton */

    void GPIO00_IRQHandler(void)
    {
        BaseType_t reveil = pdFALSE;
        uint32_t flags    = GPIO_GpioGetInterruptFlags(GPIO0);

        GPIO_GpioClearInterruptFlags(GPIO0, flags);
        if (flags & (1U << BOARD_SW2_GPIO_PIN))
            xSemaphoreGiveFromISR(s_semSW2, &reveil);
        portYIELD_FROM_ISR(reveil); /* si la tache bouton est plus prioritaire, elle passe tout de suite */
    }

    /* Tache 1 : fait clignoter le rouge toutes les 500 ms */
    static void tache_rouge(void *pvParameters)
    {
        for (;;)
        {
            LED_RED_TOGGLE();
            vTaskDelay(pdMS_TO_TICKS(500)); /* la tache dort : le processeur est libre pour les autres */
        }
    }

    /* Tache 2 : fait clignoter le bleu toutes les 300 ms */
    static void tache_bleue(void *pvParameters)
    {
        for (;;)
        {
            LED_BLUE_TOGGLE();
            vTaskDelay(pdMS_TO_TICKS(300));
        }
    }

    /* Tache 3 : attend SW2 (sans consommer de temps processeur) et bascule le vert */
    static void tache_bouton(void *pvParameters)
    {
        int nbAppuis = 0;
        for (;;)
        {
            xSemaphoreTake(s_semSW2, portMAX_DELAY); /* bloquee jusqu'au prochain appui */
            LED_GREEN_TOGGLE();
            PRINTF("SW2 appuye (%d fois)\r\n", ++nbAppuis);
            vTaskDelay(pdMS_TO_TICKS(50));           /* anti-rebond */
            xSemaphoreTake(s_semSW2, 0);             /* oublie un rebond eventuel */
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

        LED_Init();
        BOUTON_Init(BOARD_SW2_GPIO_PIN);
        s_semSW2 = xSemaphoreCreateBinary();

        /* Une interruption qui appelle FreeRTOS (...FromISR) doit avoir une priorite
           >= configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY (0 = la plus haute, interdite ici) */
        NVIC_SetPriority(BOARD_SW2_IRQ, configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY);
        EnableIRQ(BOARD_SW2_IRQ);

        PRINTF("\r\nTD1 - etape 4 : 3 taches FreeRTOS\r\n");
        xTaskCreate(tache_rouge, "Rouge", configMINIMAL_STACK_SIZE + 100, NULL, 1, NULL);
        xTaskCreate(tache_bleue, "Bleue", configMINIMAL_STACK_SIZE + 100, NULL, 1, NULL);
        xTaskCreate(tache_bouton, "Bouton", configMINIMAL_STACK_SIZE + 200, NULL, 2, NULL);
        vTaskStartScheduler(); /* ne revient jamais : FreeRTOS prend la main */
        for (;;)
            ;
    }
    ```

**`NVIC_SetPriority` est indispensable.** Par défaut, une interruption a la priorité 0 (la plus haute). FreeRTOS interdit d'appeler ses fonctions `...FromISR` depuis une interruption plus prioritaire que `configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY` (2 ici) : sans cette ligne, le programme peut se bloquer dans un `configASSERT` au premier appui.

**Questions**

1. Comparer `tache_rouge` avec la boucle de la partie 1 : qui s'occupe de compter le temps ?
2. Dans `tache_rouge`, remplacer `vTaskDelay(...)` par `SDK_DelayAtLeastUs(500000U, SystemCoreClock)`. Le bleu clignote-t-il toujours ? Et si on donne à `tache_rouge` la priorité 3 ? Expliquez (on parle de **famine**).
3. Pourquoi la tâche bouton a-t-elle une priorité plus haute (2) que les tâches de clignotement (1) ?
4. Que se passe-t-il si on appuie 5 fois très vite sur SW2 ? Un sémaphore **binaire** peut-il compter les appuis ? (Pour aller plus loin : sémaphore à compteur, ou **file de messages** `xQueueSendFromISR`.)

## Partie 5 — Projet : feu tricolore avec bouton piéton

On réutilise le projet de la partie 4. La LED RGB devient un **feu tricolore** pour les voitures : **vert**, **orange** (rouge + vert, `JAUNE`), **rouge**. Le bouton **SW2** est le **bouton piéton**.

**5.1 Cahier des charges**

| N° | Exigence |
| --- | --- |
| F1 | Cycle normal : **vert 6 s → orange 2 s → rouge 5 s →** vert… Le feu démarre au **rouge**. |
| F2 | À chaque changement d'état, le terminal affiche l'heure en ms depuis le démarrage et l'état, par exemple `[ 13000 ms] VERT`. |
| F3 | Un appui sur **SW2** pendant le vert affiche `Demande pieton enregistree` et **raccourcit le vert** : on passe à l'orange tout de suite… |
| F4 | … mais le vert dure **au moins 2 s** au total (les voitures doivent pouvoir passer). |
| F5 | Après une demande piéton, le rouge dure **8 s** au lieu de 5 s. Un appui pendant l'orange ou le rouge ne compte pas. |
| F6 | Une seule tâche gère le feu ; le bouton est lu **par interruption**, jamais en scrutation. |
| Bonus | **Mode nuit** : un appui sur **SW3** met le feu en **orange clignotant** (1 Hz). Un nouvel appui revient au cycle normal, en commençant par le rouge. |

**5.2 Une machine à états**

Un feu tricolore est une **machine à états** : à chaque instant, il est dans un état (vert, orange, rouge) ; il change d'état au bout d'une durée ou sur un événement (bouton).

```
        6 s (ou SW2, après 2 s minimum)
 VERT ─────────────────────────────────► ORANGE
  ▲                                        │ 2 s
  │       5 s (8 s après une demande)      ▼
  └────────────────────────────────────── ROUGE
```

On écrit une tâche avec un `switch` sur l'état courant. Commencer par ce squelette (à mettre à la place de `tache_rouge`, `tache_bleue` et `tache_bouton`) :

```c
#define DUREE_VERT_MS          6000
#define DUREE_VERT_MIN_MS      2000
#define DUREE_ORANGE_MS        2000
#define DUREE_ROUGE_MS         5000
#define DUREE_ROUGE_PIETON_MS  8000

typedef enum { FEU_VERT, FEU_ORANGE, FEU_ROUGE } etat_feu_t;

static unsigned int Maintenant_ms(void)
{
    return (unsigned int)(xTaskGetTickCount() * portTICK_PERIOD_MS);
}

static void tache_feu(void *pvParameters)
{
    etat_feu_t etat = FEU_ROUGE;

    for (;;)
    {
        switch (etat)
        {
            case FEU_VERT:
                LED_Couleur(VERT);
                PRINTF("[%6u ms] VERT\r\n", Maintenant_ms());
                vTaskDelay(pdMS_TO_TICKS(DUREE_VERT_MS));
                etat = FEU_ORANGE;
                break;

            case FEU_ORANGE:
                /* A completer */
                break;

            case FEU_ROUGE:
                /* A completer */
                break;
        }
    }
}
```

Dans `main()`, ne créer que `tache_feu` (priorité 2, pile `configMINIMAL_STACK_SIZE + 200`).

**5.3 Travail demandé, étape par étape**

1. **F1 et F2.** Compléter les états `FEU_ORANGE` et `FEU_ROUGE`. Vérifier les durées dans le terminal.
2. **F3.** Pendant le vert, la tâche ne doit plus dormir « aveuglément » : remplacer `vTaskDelay(...)` par une **attente du sémaphore avec délai maximal** :

    ```c
    if (xSemaphoreTake(s_semSW2, pdMS_TO_TICKS(DUREE_VERT_MS)) == pdTRUE)
    {
        /* reveillee par SW2 avant la fin du vert */
    }
    else
    {
        /* les 6 s sont passees sans appui */
    }
    ```

    La fonction rend `pdTRUE` dès que le bouton est appuyé, ou `pdFALSE` au bout de 6 s : une seule ligne remplace l'attente **et** la surveillance du bouton.
3. **F4.** Si l'appui arrive avant 2 s de vert, attendre le temps qui manque. Utiliser `Maintenant_ms()` pour mesurer le temps passé dans l'état.
4. **F5.** Mémoriser la demande dans une variable `demandePieton` pour choisir la durée du rouge. En entrant dans le vert, **vider** le sémaphore (`xSemaphoreTake(s_semSW2, 0)`) pour oublier un appui fait pendant le rouge. Pensez aussi à l'anti-rebond.
5. **Bonus.** SW3 doit aussi réveiller la tâche, avec une information différente (« piéton » ou « nuit »). Un sémaphore ne transporte pas d'information : remplacer le sémaphore par une **file de messages** (`xQueueCreate`, `xQueueSendFromISR` dans l'interruption, `xQueueReceive` avec délai dans la tâche). Ajouter un état `FEU_NUIT`.

**5.4 Tests à faire et à noter**

| Test | Résultat attendu | OK ? |
| --- | --- | --- |
| Aucun appui pendant 30 s | Vert 6 s, orange 2 s, rouge 5 s, en boucle | |
| SW2 à 1 s de vert | Le vert dure 2 s, puis orange, puis rouge **8 s** | |
| SW2 à 4 s de vert | Orange tout de suite, puis rouge 8 s | |
| SW2 pendant le rouge, puis plus rien | Le vert suivant dure 6 s (l'appui est oublié) | |
| SW2 appuyé 10 fois très vite pendant le vert | Une seule demande enregistrée | |
| Bonus : SW3 à n'importe quel moment | Orange clignotant ; SW3 à nouveau : retour au rouge | |

**Questions**

1. Pourquoi faut-il démarrer (et revenir du mode nuit) par le **rouge**, plutôt que par le vert ?
2. Quelle est la précision des durées affichées ? D'où vient-elle (pensez à `configTICK_RATE_HZ`) ?
3. Comment ajouter un **feu piéton** (bonhomme rouge / vert) sur une autre broche ? Faut-il une deuxième tâche ?

## Dépannage, synthèse et sources

| Symptôme | Cause probable | Solution |
| --- | --- | --- |
| La LED verte ou bleue ne s'allume jamais | Broche pas en GPIO, horloge du port 1 ou du GPIO1 oubliée | Appeler `LED_Init()` (partie 2.1) |
| Couleurs inversées (LED allumée quand on veut l'éteindre) | Oubli de l'état actif bas | 0 = allumée, 1 = éteinte |
| `PORT_SetPinMux` inconnu à la compilation | `#include "fsl_port.h"` manquant | Ajouter l'include |
| Un appui sur SW2 ne fait rien | `IBE` manquant, `EnableIRQ` oublié, ou appui sur RESET | Vérifier `BOUTON_Init` et `EnableIRQ(BOARD_SW2_IRQ)` |
| Un appui fait avancer de 2 couleurs | Rebonds du bouton | Garder l'anti-rebond de 50 ms |
| FreeRTOS se bloque au premier appui | Priorité de l'interruption trop haute | `NVIC_SetPriority(BOARD_SW2_IRQ, configLIBRARY_MAX_SYSCALL_INTERRUPT_PRIORITY)` |
| `Task creation failed!` ou rien ne démarre | Plus de mémoire pour les tâches | Réduire les piles ou augmenter `configTOTAL_HEAP_SIZE` dans `FreeRTOSConfig.h` |
| Une tâche ne s'exécute plus | Une tâche plus prioritaire ne fait jamais `vTaskDelay` ni d'attente | Toujours bloquer les tâches (`vTaskDelay`, `xSemaphoreTake`…) |
| L'exemple `freertos_hello` n'apparaît pas dans l'assistant | SDK téléchargé sans FreeRTOS | Refaire le SDK dans le SDK Builder en cochant **FreeRTOS** |

**Questions de synthèse**

1. Quelles sont les trois choses à régler pour utiliser une broche du MCX N947 ? À quoi sert chacune ?
2. Scrutation ou interruption : donnez un avantage de chaque méthode.
3. Quelle différence entre `SDK_DelayAtLeastUs` et `vTaskDelay` ? Laquelle utiliser dans une tâche FreeRTOS, et pourquoi ?
4. À quoi sert un sémaphore ? Et une file de messages ?

**À vérifier selon votre installation :** ce TD suit les exemples `gpio_led_output`, `gpio_input_interrupt` et `freertos_hello` du **SDK FRDM-MCXN947 2.14.0** (broches et macros de `board.h` : LED rouge P0\_10, verte P0\_27, bleue P1\_2, SW2 P0\_23, SW3 P0\_6, interruption `GPIO00_IRQn`). Avec une autre version du SDK, les noms des fichiers ou la catégorie des exemples dans l'assistant peuvent changer : vérifier `board.h`.

**Sources :** [Exemples MCUXpresso SDK 2.14.0 pour la FRDM-MCXN947](https://github.com/nxp-mcuxpresso/mcux-sdk-examples/tree/MCUX_2.14.0_MCXNx4x/frdmmcxn947) (`board.h`, `driver_examples/gpio`, `freertos_examples/freertos_hello`) · [Pilote GPIO du SDK (fsl\_gpio.h)](https://github.com/nxp-mcuxpresso/mcux-sdk/blob/main/drivers/gpio/fsl_gpio.h) · [Carte FRDM-MCXN947 (NXP)](https://www.nxp.com/design/design-center/development-boards-and-designs/FRDM-MCXN947) · [Documentation FreeRTOS : tâches, sémaphores, files](https://www.freertos.org/Documentation/02-Kernel/02-Kernel-features/00-Developer-docs)
