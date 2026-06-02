# Quiz
https://a21-null.github.io/quiz/

Aplicación de quiz local. Carga preguntas desde archivos JSON con formato:




```json
[
  {
    "exam": "Examen 2024",
    "q": "Texto del enunciado",
    "type": "multiple",
    "options": ["Opción A", "Opción B", "Opción C", "Opción D"],
    "a": "Opción B",
    "explicacion": "Aparece tras corregir (opcional)",
    "img_q": "ruta/imagen_enunciado.png",
    "img_a": "ruta/imagen_explicacion.png"
  }
]
```

Todas las preguntas siguen un mismo formato. Todas las preguntas tienen `exam`, `q`, `type` y `a`. Campos totales:

`exam`, `q`, `type`, `options`, `points`, `html_context`, `figure`, `files`, `a`, `explicacion` (`img_q`/`img_a` opcionales).

Valores de `type`: `multiple` (con `options`), `theory` (respuesta abierta autoevaluada), `figure` y `code` (editor de código en el navegador). Las claves específicas de cada tipo solo aparecen cuando aplican.

El campo `q` y las `options` admiten HTML inline (`<table>`, `<code>`, `<br>`, etc.) y expresiones LaTeX (`$...$`, `$$...$$`).


## Modos
* Normal: Modo predeterminado, enseña la pregunta --> respondes --> corriges respuesta
* Recall: Sale la pregunta, te enseña la respuesta un tiempo límite, te la lees, luego te la oculta y tienes que escribirla de memoria.

## Ficheros

- `index.html` — versión modular (CSS en `css/`, JS en `js/`).
- `standalone.html` — todo el código (CSS + JS) embebido en un único archivo.