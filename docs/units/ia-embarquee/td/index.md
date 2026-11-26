# TDs — IA embarquée

| TD | Sujet | Matériel |
| --- | --- | --- |
| [TD1](td1/index.md) | Prise en main de la carte : LED RGB (rouge, vert, bleu), boutons SW2 / SW3 par interruption, tâches FreeRTOS d'un drone (périodes, priorités, ordonnancement). Chaque étape part d'un exemple du SDK (`gpio_led_output`, `gpio_input_interrupt`, `freertos_hello`) | FRDM-MCXN947 |
| [TD2](td2/index.md) | FreeRTOS en profondeur avec le drone VIGIE : tick et changement de contexte, états des tâches, dérive et gigue, charge du processeur, files, interruption et notification, mutex et inversion de priorité, pile et tas. Synthèse : tâches périodiques et **MobileNet sur le NPU** (`tflm_label_image` + FreeRTOS). Travail **noté** : feu tricolore avec bouton piéton | FRDM-MCXN947 |
