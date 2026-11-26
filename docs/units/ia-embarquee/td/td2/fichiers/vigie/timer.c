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
