# Vendorizado: VibeCodeViewer

`model.js` y `builder.js` son copia VERBATIM de
[Sendery/VibeCodeViewer](https://github.com/Sendery/VibeCodeViewer) (licencia
**Apache-2.0**), el motor de la ciudad 3D. No se altera su lógica; solo se les
alimenta el árbol del proyecto abierto (adaptador en `../city.js`) y `three` se
resuelve por el import map de `index.html`. `ownership.js` es un stub mínimo
(no usamos metadatos de propiedad) y `theme.js` es el tema «hacker» original.
