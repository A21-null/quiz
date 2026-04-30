# Quiz
https://a21-null.github.io/quiz/

Aplicación de quiz local en un único archivo HTML. Carga preguntas desde archivos JSON con formato:

```json
[
  {
    "exam": "Examen 2024",
    "q": "Texto del enunciado",
    "type": "multiple",
    "difficulty": 2,
    "options": ["Opción A", "Opción B", "Opción C", "Opción D"],
    "a": "Opción B",
    "explicacion": "Aparece tras corregir (opcional)",
    "img_q": "ruta/imagen_enunciado.png",
    "img_a": "ruta/imagen_explicacion.png"
  }
]
```

El campo `q` y las `options` admiten HTML inline (`<table>`, `<code>`, `<br>`, etc.) y expresiones LaTeX (`$...$`, `$$...$$`).
