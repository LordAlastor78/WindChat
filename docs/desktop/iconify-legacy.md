
# 📚 Guía de Referencia: Iconify

**Objetivo:** Esta guía establece las reglas, sintaxis y mejores prácticas para implementar iconos usando el Web Component de **Iconify** (`<iconify-icon>`). Se debe seguir estas directrices al generar código HTML, CSS o JavaScript/TypeScript.

---

## 🚀 1. Instalación e Importación

Se debe elegir **uno** de los siguientes métodos según el entorno del proyecto:

### Opción A: Bundler (Vite, Webpack, Rollup, etc.)
```bash
npm install iconify-icon
```
```javascript
// Importar en el punto de entrada principal (main.ts / main.js)
import "iconify-icon";
```

### Opción B: CDN (Sin bundler / HTML puro)
```html
<!-- Añadir en el <head> o antes del cierre del <body> -->
<script src="https://code.iconify.design/iconify-icon/3.0.0/iconify-icon.min.js"></script>
```

---

## 🧩 2. Sintaxis Básica

El componente base es `<iconify-icon>`. El atributo `icon` es **obligatorio** y sigue el formato `prefijo:nombre` (ej. `mdi:home`, `bi:check2-circle`).

```html
<!-- Ejemplo básico -->
<iconify-icon icon="mdi:home"></iconify-icon>
```

---

## 🎨 3. Estilos y Dimensiones

Se debe usar atributos nativos o CSS `style` para modificar la apariencia.

> ⚠️ **Regla:** El atributo `color` (o CSS `color`) **solo funciona en iconos monotono**. Los iconos con colores predefinidos ignorarán este cambio.

### Cambiar Color y Tamaño
```html
<!-- Usando estilo inline (Recomendado para dinamismo) -->
<iconify-icon icon="mdi:alert" style="color: #ba3329; font-size: 48px;"></iconify-icon>

<!-- Usando atributos width/height (Mantiene el ratio de aspecto) -->
<iconify-icon icon="cil:locomotive" height="36"></iconify-icon>
<iconify-icon icon="cil:truck" width="36"></iconify-icon>
```

---

## 🔄 4. Transformaciones

Hermes puede rotar o voltear iconos sin necesidad de CSS externo, usando atributos nativos que modifican el `viewBox` del SVG internamente.

```html
<!-- Volteo (flip) -->
<iconify-icon icon="bi:check2-circle" flip="horizontal"></iconify-icon>
<iconify-icon icon="bi:check2-circle" flip="vertical"></iconify-icon>
<iconify-icon icon="bi:check2-circle" flip="horizontal,vertical"></iconify-icon> <!-- Equivale a 180° -->

<!-- Rotación -->
<iconify-icon icon="bi:check2-circle" rotate="90deg"></iconify-icon>
<iconify-icon icon="bi:check2-circle" rotate="180deg"></iconify-icon>
<iconify-icon icon="bi:check2-circle" rotate="270deg"></iconify-icon>
```

---

## ⚠️ 5. Reglas Críticas de Hermes (Must Follow)

Al generar código, Hermes **DEBE** aplicar estas reglas para evitar errores comunes:

1. **Evitar Layout Shift (Desplazamiento de diseño):**
   El web component tiene un retraso mínimo de renderizado. Hermes debe inyectar o asegurar que este CSS exista en el proyecto:
   ```css
   iconify-icon {
     display: inline-block;
     width: 1em;
     height: 1em;
     vertical-align: -0.125em; /* Alineación vertical con texto */
   }
   ```
2. **PROHIBIDO usar Icon Fonts:** Hermes nunca debe sugerir o generar código para FontAwesome (versión webfont), Material Icons (font), etc. Iconify usa SVG bajo demanda, que es superior en nitidez, tamaño y rendimiento.
3. **Shadow DOM:** Hermes debe recordar que el SVG se renderiza dentro de un Shadow DOM. No se debe intentar seleccionar elementos internos del icono (como `<path>`) con CSS global del proyecto.
4. **Nuxt / SSR:** Si el proyecto usa Nuxt, Hermes debe añadir esta configuración en `nuxt.config.ts` para evitar errores de hidratación:
   ```typescript
   export default defineNuxtConfig({
     vue: {
       compilerOptions: {
         isCustomElement: (tag) => tag === "iconify-icon",
       },
     },
   });
   ```
5. **Rendimiento en listas largas:** Por defecto, Iconify v2+ solo renderiza iconos visibles (Intersection Observer). Si Hermes necesita que un icono se renderice inmediatamente aunque esté oculto, debe añadir el atributo `noobserver`:
   ```html
   <iconify-icon icon="mdi:loading" noobserver></iconify-icon>
   ```

---

## ⚙️ 6. Funciones Avanzadas (JavaScript / TypeScript)

Si Hermes necesita manipular iconos programáticamente, debe usar las funciones exportadas por `iconify-icon`:

```javascript
import { loadIcon, iconLoaded, addIcon } from "iconify-icon";

// 1. Cargar un icono bajo demanda (Promise)
loadIcon("mdi:home").then((data) => {
  console.log("Datos del icono cargados:", data);
});

// 2. Verificar si un icono ya está en caché
if (iconLoaded("mdi:home")) {
  console.log("El icono está listo para usarse");
}

// 3. Registrar un icono personalizado localmente
addIcon("custom:my-icon", {
  body: '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" fill="currentColor"/>',
  width: 24,
  height: 24
});
```

---

## 📝 7. Checklist de Generación de Código para Hermes

Antes de entregar un bloque de código con iconos, se debe verificar:
- [ ] ¿He usado la sintaxis `<iconify-icon icon="prefix:name">`?
- [ ] ¿He evitado usar librerías de fuentes de iconos?
- [ ] ¿He añadido estilos de tamaño/color de forma segura (inline o atributos)?
- [ ] ¿El CSS de prevención de *layout shift* está considerado en el proyecto?

---

*Nota para el usuario: Copia y pega este bloque en un archivo `.md` y úsalo como documento de referencia o "System Prompt" para que tu agente genere código de Iconify perfectamente alineado con las mejores prácticas.*
