# WHITEMOON-INMOPLUS

Demo inmobiliaria **Inmoplus · Majadahonda** — creada por WhiteMoon Agencia IA.

- **Home:** https://nexusforgeia.github.io/WHITEMOON-INMOPLUS/
- **Panel IA:** https://nexusforgeia.github.io/WHITEMOON-INMOPLUS/panel/ (noindex)

Clon de la demo `WHITEMOON-INMOBILIARIAS` repuntado a un backend aislado en
Supabase (proyecto `mlaqtniujnvfxcvcourm`):

| Recurso | Inmoplus |
|---|---|
| Edge functions | `inmoplus-captacion` · `inmoplus-recordatorios` · `inmoplus-extraer` · `inmoplus-anuncio` · `inmoplus-panel` · `inmoplus-propiedades` |
| Tablas | `inmoplus_leads` · `inmoplus_propiedades` · `inmoplus_contratos` |

El chatbot Carlos capta leads contra `inmoplus-captacion` (payload
`{nombre, telefono, mensaje, operacion, zona, tipo, origen}`).
