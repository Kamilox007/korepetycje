// Zakres suwaka grubości obramowania (PageEditor wstrzykuje go do panelu
// Excalidrawa, BoardScreen pamięta wybór per tablica). Poniżej ~0,5 kreska
// rysuje się jako wygładzony półpiksel (jaśniejsza, nie cieńsza) - to granica
// ekranu, nie Excalidrawa.
export const STROKE_MIN = 0.1;
export const STROKE_MAX = 4;
export const STROKE_DEFAULT = 2;
