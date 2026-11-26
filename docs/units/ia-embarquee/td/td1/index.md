# TD1 : Prise en main de la FRDM-MCXN947 — LED, boutons et FreeRTOS


## Objectifs, prérequis et déroulé

Dans ce TD, on découvre la carte NXP **FRDM-MCXN947** en programmant ses entrées et sorties. On ne part jamais d'une page blanche : chaque étape commence par un **exemple du SDK** qui fonctionne déjà, qu'on compile, qu'on lit, puis qu'on **enrichit pas à pas**. Les parties 1 à 4 sont **guidées** : le code est donné et expliqué, chaque question a sa réponse (à déplier **après** avoir cherché).

!!! tip "Comment travailler"
    Pour chaque partie : lire, taper (ou copier) le code, **compiler et essayer sur la carte**, puis répondre aux questions **avant** d'ouvrir les réponses.

| Étape | Exemple du SDK de départ | Ce qu'on ajoute |
| --- | --- | --- |
| 1 | `gpio_led_output` | Lire le code, changer la vitesse de clignotement |
| 2 | (le même) | Les trois couleurs de la LED RGB et leurs mélanges |
| 3 | `gpio_input_interrupt` | Les boutons SW2 et SW3 par interruption, l'anti-rebond |
| 4 | `freertos_hello` | Les 3 tâches d'un drone : périodes, priorités, ordonnancement |

**Matériel**

- Carte NXP FRDM-MCXN947, câble USB-C sur le connecteur **MCU-Link (J17)**.

**Logiciel**

- MCUXpresso IDE et le **SDK FRDM-MCXN947 2.14.0** (avec le composant **FreeRTOS**, coché par défaut dans le SDK Builder).
- Un terminal série : celui de MCUXpresso IDE suffit (**115200 bauds, 8 bits, pas de parité, 1 bit de stop**).

**Durée :** environ 2 h.

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

!!! abstract "À retenir"
    Une broche s'appelle **Px\_n** : port x, broche n. Pour s'en servir : **horloge** (`CLOCK_EnableClock`), **PORT** (quelle fonction : `kPORT_MuxAlt0` = GPIO), **GPIO** (entrée ou sortie, lecture, écriture). Les LED de la carte s'allument avec un **0**.

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

??? success "Réponses de la partie 1"
    1. `1u << 10` vaut `0x400` : un nombre dont **seul le bit 10** est à 1. Les fonctions `GPIO_Port...` travaillent sur les 32 broches d'un port à la fois : chaque bit à 1 désigne une broche. Avec `10` (= `0b1010`), on inverserait les broches 1 et 3 !
    2. Elle est **allumée** : la LED est active à l'état bas, donc la valeur 0 l'allume.
    3. La LED clignote **4 fois plus vite** (la boucle est 4 fois plus courte). Un `delay()` dure une **demi-période** : la LED est allumée pendant un `delay()`, puis éteinte pendant le suivant. Durée d'un `delay()` ≈ (temps de 10 clignotements) / 20.
    4. La durée dépend de la **fréquence du processeur**, du **compilateur** (en mode *Release*, l'optimisation change le nombre d'instructions par tour) et des **interruptions** qui volent du temps. On ne sait pas combien de millisecondes dure la boucle sans la mesurer.
    5. `BOARD_InitPins()` configure **P0\_10** (LED rouge) en GPIO et **P1\_8, P1\_9** pour la liaison série (FlexComm 4). La LED bleue est sur **P1\_2** : sa broche n'est pas configurée en GPIO, et l'horloge du module **GPIO1** n'est pas activée (seul `kCLOCK_Gpio0` l'est). On règle ça à la partie 2.

!!! abstract "À retenir"
    Un exemple du SDK = `main()` qui initialise la carte (`BOARD_InitPins`, `BOARD_InitBootClocks`, `BOARD_InitDebugConsole`), puis une boucle infinie `while (1)`. Les noms `BOARD_...` viennent de `board.h` : on s'en sert pour ne pas écrire les numéros de broche à la main.

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

Sortie attendue dans le terminal :

```
TD1 - etape 2 : les couleurs de la LED RGB
LED rouge
LED vert
LED bleu
LED rouge
...
```

**À vous**

1. Modifier la séquence pour afficher les **8 couleurs** de `NOIR` à `BLANC`, avec leur nom dans le terminal.
2. Le jaune obtenu ressemble-t-il à du jaune ? Et à de l'orange ? Pourquoi est-ce difficile d'obtenir un vrai orange en allumant simplement les LED rouge et verte ? (Indice : il faudrait régler la *luminosité* de chaque LED, avec un signal PWM.)
3. Écrire une fonction `LED_Clignoter(int couleur, int nb, int periode_ms)` qui fait clignoter `nb` fois une couleur. L'utiliser pour faire clignoter 3 fois le magenta au démarrage.

??? success "Réponses de la partie 2"
    1. Il suffit de parcourir les nombres de 0 à 7, puisque chaque couleur **est** un nombre :

        ```c
        const char *const noms[] = {"noir", "rouge", "vert", "jaune", "bleu", "magenta", "cyan", "blanc"};
        while (1)
        {
            for (int c = NOIR; c <= BLANC; c++)
            {
                LED_Couleur(c);
                PRINTF("Couleur %d : %s\r\n", c, noms[c]);
                SDK_DelayAtLeastUs(500000U, SystemCoreClock);
            }
        }
        ```

    2. On obtient un jaune-vert : la LED verte paraît plus lumineuse que la rouge. Pour un orange, il faudrait **moins** de vert que de rouge. Une broche GPIO ne sait faire que « tout ou rien » ; pour doser la luminosité, on allume et on éteint la LED très vite (plus vite que l'œil) avec un rapport cyclique réglable : c'est la **PWM**.
    3. Une solution :

        ```c
        static void LED_Clignoter(int couleur, int nb, int periode_ms)
        {
            for (int i = 0; i < nb; i++)
            {
                LED_Couleur(couleur);
                SDK_DelayAtLeastUs(periode_ms * 1000U / 2, SystemCoreClock);
                LED_Couleur(NOIR);
                SDK_DelayAtLeastUs(periode_ms * 1000U / 2, SystemCoreClock);
            }
        }
        /* dans main(), apres LED_Init() : */
        LED_Clignoter(MAGENTA, 3, 400);
        ```

!!! abstract "À retenir"
    `LED_Init()` (horloges + PORT + GPIO des trois LED) et `LED_Couleur()` resserviront dans toute la suite. Une couleur est un nombre de 3 bits : on teste un bit avec `&`.

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

??? success "Réponses (3.2)"
    1. L'interruption se déclenche quand la broche **passe de 1 à 0** (front descendant). Au repos, la résistance de tirage met la broche à 1 ; l'appui la relie à la masse : 0. Donc front descendant = début de l'appui.
    2. `g_ButtonPress` est modifiée par l'interruption, « dans le dos » de `main()`. Sans `volatile`, le compilateur peut garder sa valeur dans un registre et ne jamais relire la mémoire : la boucle ne verrait jamais l'appui.
    3. Une fonction d'interruption doit être **la plus courte possible** : pendant qu'elle s'exécute, le reste du programme est arrêté. `PRINTF` est lent (envoi caractère par caractère sur la liaison série). L'interruption note l'événement, la boucle principale fait le travail.
    4. Le drapeau reste levé : dès la sortie de la fonction, l'interruption repart, en boucle. Le programme principal ne s'exécute plus jamais.
    5. En **scrutation**, le processeur relit sans arrêt la broche : il ne fait rien d'autre et peut rater un appui très court s'il est occupé ailleurs. Avec une **interruption**, le matériel surveille la broche et prévient le processeur : il réagit tout de suite, même s'il fait autre chose.

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

Sortie attendue (en appuyant SW3, SW3, SW2) :

```
TD1 - etape 3 : SW3 = couleur suivante, SW2 = couleur precedente
Couleur 2 : vert
Couleur 3 : jaune
Couleur 2 : vert
```

??? success "Réponses (3.3)"
    1. Oui : un contact mécanique **rebondit** pendant quelques millisecondes en se fermant. La broche fait 1, 0, 1, 0… avant de rester à 0, ce qui produit plusieurs fronts descendants donc plusieurs interruptions pour un seul appui. Attendre 50 ms puis effacer les drapeaux fait oublier ces faux appuis.
    2. En C, `(0 - 1) % 8` vaut **-1** (le reste garde le signe) : `noms[-1]` lit en dehors du tableau. `(0 + 7) % 8` vaut 7 : on revient bien au blanc. Ajouter 7 revient à retirer 1, « modulo 8 ».
    3. Il tourne dans `while (1)` et teste sans arrêt les deux variables : il consomme autant que s'il calculait. On pourrait l'endormir avec l'instruction `__WFI()` (*wait for interrupt*) : il se réveille à l'interruption suivante. Un RTOS fait ça automatiquement quand aucune tâche n'a de travail (partie 4).

!!! abstract "À retenir"
    Interruption = **fonction appelée par le matériel**. Elle doit : savoir **qui** l'a déclenchée (`GPIO_GpioGetInterruptFlags`), **acquitter** (`GPIO_GpioClearInterruptFlags`), être **courte** (lever un drapeau `volatile`). Un bouton **rebondit** : il faut un anti-rebond. Une entrée a besoin de `IBE` et d'une résistance de tirage.

## Partie 4 — FreeRTOS : les tâches d'un drone (exemple freertos\_hello)

Jusqu'ici, tout se passe dans une seule boucle `while (1)`. Dès qu'on veut faire **plusieurs choses en même temps** (clignoter, surveiller un bouton, afficher…), cette boucle devient difficile à écrire. Un **système d'exploitation temps réel** (RTOS) comme **FreeRTOS** permet de découper le programme en **tâches** indépendantes, chacune avec sa propre boucle. L'**ordonnanceur** de FreeRTOS partage le processeur entre elles. Dans cette partie, on n'utilise **ni LED ni bouton** : seulement des tâches qui affichent du texte, pour bien voir **qui s'exécute, et quand**.

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

??? success "Réponses (4.2)"
    1. `Hello world.` s'affiche **toutes les secondes** : la tâche dort 1 s, se réveille, affiche, se rendort.
    2. 200 ticks par seconde : `pdMS_TO_TICKS(1000)` = **200 ticks**. Un tick dure 1/200 s = **5 ms** : c'est la plus petite attente, et toutes les durées sont arrondies à 5 ms près.

**4.3 Un drone en trois tâches**

Le logiciel d'un drone fait plusieurs choses **en même temps**, chacune à son rythme et avec son niveau d'urgence. On en simule trois, qui se contentent d'**afficher un texte** dans le terminal :

| Tâche | Rôle dans un vrai drone | Période | Priorité |
| --- | --- | --- | --- |
| `tache_stabilisation` (STAB) | Lit les capteurs (gyroscope, accéléromètre) et corrige la vitesse des moteurs. Si elle est en retard, le drone tombe. | 500 ms | 3 (haute) |
| `tache_navigation` (NAV) | Lit le GPS et calcule la direction à suivre. | 1000 ms | 2 |
| `tache_telemetrie` (TELEM) | Envoie l'état du drone à la station au sol. Un retard n'est pas grave. | 2000 ms | 1 (basse) |

Dans un vrai drone, la stabilisation tourne bien plus vite (toutes les quelques millisecondes) ; on ralentit tout pour pouvoir **lire** le terminal.

Remplacer **tout le contenu** de `source/freertos_hello.c` par :

```c
/* freertos_hello.c (TD1, partie 4) : les 3 taches d'un drone */
#include "FreeRTOS.h"
#include "task.h"
#include "fsl_debug_console.h"
#include "pin_mux.h"
#include "clock_config.h"
#include "board.h"

/* ===== Reglages a modifier pendant les experiences ===== */
#define PERIODE_STAB_MS   500  /* stabilisation : lit les capteurs, corrige les moteurs */
#define PERIODE_NAV_MS    1000 /* navigation : lit le GPS, calcule la direction */
#define PERIODE_TELEM_MS  2000 /* telemetrie : envoie l'etat du drone a la station au sol */

#define PRIO_STAB  3 /* de 0 (la plus basse) a 4 (la plus haute) */
#define PRIO_NAV   2
#define PRIO_TELEM 1

#define CALCUL_TELEM_MS 0 /* duree du calcul de la telemetrie (experience 4) */
/* ======================================================== */

/* Temps ecoule depuis le demarrage de FreeRTOS, en ms (1 tick = 5 ms) */
static unsigned int Temps_ms(void)
{
    return (unsigned int)(xTaskGetTickCount() * portTICK_PERIOD_MS);
}

/* Simule un calcul : le processeur travaille pendant duree_ms sans rendre la main */
static void Calcul(unsigned int duree_ms)
{
    SDK_DelayAtLeastUs(duree_ms * 1000U, SystemCoreClock);
}

/* Tache 1 : stabilisation (la plus urgente : sans elle, le drone tombe) */
static void tache_stabilisation(void *pvParameters)
{
    int n = 0;
    TickType_t reveil = xTaskGetTickCount(); /* instant du prochain reveil */
    for (;;)
    {
        PRINTF("[%6u ms] STAB  : correction des moteurs n%d\r\n", Temps_ms(), ++n);
        vTaskDelayUntil(&reveil, pdMS_TO_TICKS(PERIODE_STAB_MS)); /* dort jusqu'a la periode suivante */
    }
}

/* Tache 2 : navigation */
static void tache_navigation(void *pvParameters)
{
    int n = 0;
    TickType_t reveil = xTaskGetTickCount(); /* instant du prochain reveil */
    for (;;)
    {
        PRINTF("[%6u ms] NAV   : position GPS n%d\r\n", Temps_ms(), ++n);
        vTaskDelayUntil(&reveil, pdMS_TO_TICKS(PERIODE_NAV_MS));
    }
}

/* Tache 3 : telemetrie (la moins urgente) */
static void tache_telemetrie(void *pvParameters)
{
    int n = 0;
    TickType_t reveil = xTaskGetTickCount(); /* instant du prochain reveil */
    for (;;)
    {
        PRINTF("[%6u ms] TELEM : debut envoi n%d\r\n", Temps_ms(), ++n);
        Calcul(CALCUL_TELEM_MS);
        PRINTF("[%6u ms] TELEM : fin envoi n%d\r\n", Temps_ms(), n);
        vTaskDelayUntil(&reveil, pdMS_TO_TICKS(PERIODE_TELEM_MS));
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

    PRINTF("\r\nTD1 - partie 4 : les 3 taches d'un drone\r\n");

    xTaskCreate(tache_stabilisation, "Stab", configMINIMAL_STACK_SIZE + 200, NULL, PRIO_STAB, NULL);
    xTaskCreate(tache_navigation, "Nav", configMINIMAL_STACK_SIZE + 200, NULL, PRIO_NAV, NULL);
    xTaskCreate(tache_telemetrie, "Telem", configMINIMAL_STACK_SIZE + 200, NULL, PRIO_TELEM, NULL);

    vTaskStartScheduler(); /* l'ordonnanceur prend la main : ne revient jamais */
    for (;;)
        ;
}
```

**Ce qu'il faut comprendre dans ce code**

- Les trois tâches ont **la même forme** : une boucle infinie qui fait son travail (ici un `PRINTF`), puis **s'endort** jusqu'à sa période suivante.
- `vTaskDelayUntil(&reveil, periode)` endort la tâche jusqu'à l'instant `reveil + periode`, puis met `reveil` à jour : la tâche se réveille **exactement** toutes les 500 ms, 1000 ms… même si son travail a pris un peu de temps. (`vTaskDelay`, vu en 4.2, attend une durée **à partir de maintenant** : les petits retards s'additionneraient.)
- Pendant qu'une tâche dort, elle ne consomme **rien** : le processeur est libre pour les autres.
- `Calcul()` simule un travail long (un calcul, l'envoi d'un message) : le processeur travaille **sans rendre la main**. Il vaut 0 ms au départ ; on s'en servira à l'expérience 4.
- Tous les réglages sont regroupés en haut du fichier : pour chaque expérience, on ne change **que ces lignes**.

**Checkpoint :** **Build**, **Debug**, **Resume**. Le terminal affiche (à quelques millisecondes près) :

```
TD1 - partie 4 : les 3 taches d'un drone
[     0 ms] STAB  : correction des moteurs n1
[     0 ms] NAV   : position GPS n1
[     0 ms] TELEM : debut envoi n1
[     5 ms] TELEM : fin envoi n1
[   500 ms] STAB  : correction des moteurs n2
[  1000 ms] STAB  : correction des moteurs n3
[  1000 ms] NAV   : position GPS n2
[  1500 ms] STAB  : correction des moteurs n4
[  2000 ms] STAB  : correction des moteurs n5
[  2000 ms] NAV   : position GPS n3
[  2000 ms] TELEM : debut envoi n2
...
```

**4.4 Expériences : périodes, priorités, ordonnancement**

Faire les expériences **dans l'ordre**. Pour chacune : modifier les `#define` indiqués, **Build**, **Debug**, **Resume**, observer les 5 premières secondes du terminal, puis **remettre les valeurs d'origine** (sauf indication contraire).

| N° | Modifier | Observer |
| --- | --- | --- |
| E1 | Rien | Combien de lignes STAB, NAV et TELEM en 4 s ? À 0 ms et à 2000 ms, les trois tâches doivent s'exécuter au même instant : dans quel ordre s'affichent-elles ? |
| E2 | `PERIODE_STAB_MS 250`, `PERIODE_TELEM_MS 3000` | Combien de lignes STAB et TELEM en 6 s ? |
| E3 | `PRIO_STAB 1`, `PRIO_TELEM 3` (priorités inversées) | Dans quel ordre s'affichent les tâches à 0 ms et à 2000 ms ? Comparer avec E1. |
| E4 | Priorités d'origine, `CALCUL_TELEM_MS 700` | Que s'affiche-t-il **entre** `TELEM : debut envoi` et `TELEM : fin envoi` ? À quels instants s'affiche STAB ? |
| E5 | `CALCUL_TELEM_MS 700` et `PRIO_TELEM 4` (télémétrie la plus prioritaire) | À quels instants s'affiche STAB maintenant ? Pour un drone, est-ce grave ? |
| E6 | `CALCUL_TELEM_MS 2500` et `PRIO_TELEM 4` | Que reste-t-il dans le terminal ? Pourquoi ? |

??? success "Réponses des expériences"
    - **E1.** En 4 s : 8 STAB (toutes les 500 ms), 4 NAV, 2 TELEM. À 0 ms et 2000 ms, l'ordre est toujours **STAB, NAV, TELEM** : quand plusieurs tâches sont prêtes en même temps, l'ordonnanceur lance d'abord **la plus prioritaire**.
    - **E2.** En 6 s : 24 STAB, 2 TELEM. La période fixe le **rythme** de chaque tâche, indépendamment des autres.
    - **E3.** L'ordre devient **TELEM, NAV, STAB** : ce n'est pas l'ordre de création des tâches qui compte, c'est leur **priorité**.
    - **E4.** À 500 ms, la ligne `STAB` s'affiche **entre** `debut envoi` et `fin envoi` : la stabilisation **interrompt** la télémétrie en plein calcul, s'exécute, puis la télémétrie reprend là où elle en était. C'est la **préemption**. STAB reste à l'heure (500, 1000, 1500 ms…).
    - **E5.** La télémétrie, plus prioritaire, garde le processeur pendant ses 700 ms de calcul : STAB ne s'affiche qu'à **700 ms environ** au lieu de 0 et 500 ms (deux lignes d'un coup, en retard). Pour un drone, la stabilisation corrigée avec 700 ms de retard, c'est la chute : il faut donner la plus haute priorité à la tâche **la plus urgente**, pas à la plus longue.
    - **E6.** Il ne reste que des lignes `TELEM` : son calcul (2500 ms) dure plus que sa période (2000 ms), elle n'a jamais le temps de dormir. Étant la plus prioritaire, elle ne laisse **jamais** le processeur aux autres : c'est la **famine**.

**4.5 Comment FreeRTOS choisit la tâche à exécuter**

Chaque tâche est dans l'un de ces états :

| État | Signification | Exemple |
| --- | --- | --- |
| **En cours** | Elle utilise le processeur (une seule à la fois) | STAB pendant son `PRINTF` |
| **Prête** | Elle voudrait s'exécuter, mais une tâche plus prioritaire a le processeur | TELEM à 0 ms, pendant que STAB et NAV s'affichent |
| **Bloquée** | Elle dort (`vTaskDelayUntil`, `vTaskDelay`) et ne demande rien | NAV entre deux positions GPS |

L'**ordonnanceur** de FreeRTOS applique une règle simple, à chaque *tick* (toutes les 5 ms) et chaque fois qu'une tâche s'endort ou se réveille :

> **Parmi les tâches prêtes, c'est toujours la plus prioritaire qui s'exécute.** Si une tâche plus prioritaire se réveille, elle prend le processeur **tout de suite**, même au milieu du travail d'une autre (préemption).

C'est un ordonnancement **préemptif à priorités fixes**. Quand aucune tâche n'est prête, FreeRTOS exécute sa propre tâche **Idle** (priorité 0), qui ne fait rien.

Exemple de l'expérience E4, de 0 à 900 ms :

```
temps (ms)  0    100  200  300  400  500  600  700  800
            |    |    |    |    |    |    |    |    |
STAB  (p3)  #                        #
NAV   (p2)  #
TELEM (p1)  #########################.##########
Idle  (p0)                                      #########

# = s'execute   . = prete mais preemptee par STAB   (1 caractere = 20 ms)
```

**Questions**

1. Pourquoi donne-t-on à la stabilisation la priorité la plus haute ? Proposez une règle simple pour choisir les priorités à partir des périodes.
2. Dans l'expérience E4, la télémétrie calcule 700 ms toutes les 2000 ms. Quelle part du temps processeur occupe-t-elle ? Combien reste-t-il pour la tâche Idle (en négligeant les `PRINTF`) ?
3. Dans le code, quelle ligne fait passer une tâche de l'état **En cours** à l'état **Bloquée** ? Qui la fait repasser à l'état **Prête** ?
4. Pourquoi ne faut-il jamais attendre avec `SDK_DelayAtLeastUs` (attente active) dans une tâche, mais toujours avec `vTaskDelay` ou `vTaskDelayUntil` ?

??? success "Réponses (4.5)"
    1. C'est la tâche la plus **urgente** : un retard fait tomber le drone (expérience E5). Règle simple : **plus la période est courte, plus la priorité est haute** (ordonnancement *Rate Monotonic*). C'est exactement le choix fait ici : 500 ms → 3, 1000 ms → 2, 2000 ms → 1.
    2. 700 / 2000 = **35 %** du temps processeur. Il reste environ 65 % pour la tâche Idle (STAB et NAV ne font qu'un `PRINTF` de quelques millisecondes).
    3. `vTaskDelayUntil(...)` bloque la tâche. C'est l'**ordonnanceur** de FreeRTOS, à chaque tick, qui voit que l'instant de réveil est atteint et la remet dans l'état **Prête** ; elle s'exécute dès qu'aucune tâche plus prioritaire n'est prête.
    4. Une attente active garde le processeur : les tâches moins prioritaires ne s'exécutent plus (famine, E6), et on gaspille de l'énergie. `vTaskDelay` / `vTaskDelayUntil` **bloquent** la tâche : le processeur est rendu aux autres.

!!! abstract "À retenir"
    Une **tâche** = une fonction avec sa boucle infinie, sa pile, sa **période** et sa **priorité**. Une tâche périodique fait son travail puis s'endort avec `vTaskDelayUntil`. L'ordonnanceur exécute **toujours la tâche prête la plus prioritaire** et peut interrompre une tâche moins prioritaire (**préemption**). Une tâche qui ne s'endort jamais affame les tâches moins prioritaires. On donne la priorité la plus haute à la tâche la plus urgente.

## Dépannage, synthèse et sources

| Symptôme | Cause probable | Solution |
| --- | --- | --- |
| La LED verte ou bleue ne s'allume jamais | Broche pas en GPIO, horloge du port 1 ou du GPIO1 oubliée | Appeler `LED_Init()` (partie 2.1) |
| Couleurs inversées (LED allumée quand on veut l'éteindre) | Oubli de l'état actif bas | 0 = allumée, 1 = éteinte |
| `PORT_SetPinMux` inconnu à la compilation | `#include "fsl_port.h"` manquant | Ajouter l'include |
| Un appui sur SW2 ne fait rien | `IBE` manquant, `EnableIRQ` oublié, ou appui sur RESET | Vérifier `BOUTON_Init` et `EnableIRQ(BOARD_SW2_IRQ)` |
| Un appui fait avancer de 2 couleurs | Rebonds du bouton | Garder l'anti-rebond de 50 ms |
| `Task creation failed!` ou rien ne démarre | Plus de mémoire pour les tâches | Réduire les piles ou augmenter `configTOTAL_HEAP_SIZE` dans `FreeRTOSConfig.h` |
| Une tâche ne s'exécute plus | Une tâche plus prioritaire ne fait jamais `vTaskDelay` ni d'attente | Toujours endormir les tâches (`vTaskDelay`, `vTaskDelayUntil`), jamais d'attente active |
| L'exemple `freertos_hello` n'apparaît pas dans l'assistant | SDK téléchargé sans FreeRTOS | Refaire le SDK dans le SDK Builder en cochant **FreeRTOS** |

**Questions de synthèse**

1. Quelles sont les trois choses à régler pour utiliser une broche du MCX N947 ? À quoi sert chacune ?
2. Scrutation ou interruption : donnez un avantage de chaque méthode.
3. Quelle différence entre `SDK_DelayAtLeastUs` et `vTaskDelay` ? Laquelle utiliser dans une tâche FreeRTOS, et pourquoi ?
4. Comment l'ordonnanceur de FreeRTOS choisit-il la tâche à exécuter ? Qu'est-ce que la préemption ?

**À vérifier selon votre installation :** ce TD suit les exemples `gpio_led_output`, `gpio_input_interrupt` et `freertos_hello` du **SDK FRDM-MCXN947 2.14.0** (broches et macros de `board.h` : LED rouge P0\_10, verte P0\_27, bleue P1\_2, SW2 P0\_23, SW3 P0\_6, interruption `GPIO00_IRQn`). Avec une autre version du SDK, les noms des fichiers ou la catégorie des exemples dans l'assistant peuvent changer : vérifier `board.h`.

**Sources :** [Exemples MCUXpresso SDK 2.14.0 pour la FRDM-MCXN947](https://github.com/nxp-mcuxpresso/mcux-sdk-examples/tree/MCUX_2.14.0_MCXNx4x/frdmmcxn947) (`board.h`, `driver_examples/gpio`, `freertos_examples/freertos_hello`) · [Pilote GPIO du SDK (fsl\_gpio.h)](https://github.com/nxp-mcuxpresso/mcux-sdk/blob/main/drivers/gpio/fsl_gpio.h) · [Carte FRDM-MCXN947 (NXP)](https://www.nxp.com/design/design-center/development-boards-and-designs/FRDM-MCXN947) · [Documentation FreeRTOS : tâches et ordonnancement](https://www.freertos.org/Documentation/02-Kernel/02-Kernel-features/00-Developer-docs)
