# UX Roadmap — Hydra NFT Marketplace

**Fecha:** 2026-03-30
**Estado:** ✅ Todas las fases implementadas (sesiones 3 y 4)
**Objetivo:** Los usuarios tradean dentro del Hydra Head sin saber que lo están usando. Las operaciones dentro del Head son costo-0 o más baratas que en L1. La infraestructura de Hydra es invisible para el usuario final.

---

## 1. Diagnóstico de problemas

### P1 — CRÍTICO: El flujo de venta expone el ciclo de vida del Head

**Severidad:** Alta — bloquea usuarios reales
**Archivos:** `frontend/app/sell/SellForm.tsx`
**Causa raíz:** El commit clásico requiere que el token del farmer y el ADA del operador se encapsulen juntos en la misma transacción L1 antes de abrir el Head. El acto de "publicar una venta" quedó acoplado al acto de "abrir la infraestructura L2".

**Síntoma:** El vendedor ve y ejecuta botones con terminología interna de Hydra:
- "Commit al Head" (requiere firma partialSign=true)
- "Abrir Head (Collect)" (espera HeadIsOpen ~30s)
- "Dividir ADA" (operación interna del operador)
- Indicadores de estado: "Initializing / Open / Idle"

Un agricultor que quiere vender su cosecha no debería interactuar con ninguno de estos pasos.

---

### P2 — CRÍTICO: El Head lifecycle depende del estado de la UI del vendedor

**Severidad:** Alta
**Archivos:** `frontend/app/sell/SellForm.tsx`, `backend/src/api/head.ts`
**Causa raíz:** Si el Head está `Idle`, el botón "Commit al Head" no aparece. Si está `Open` con tokens de otro farmer, tampoco puede agregar uno nuevo (incremental deposits están rotos en Hydra v1.2.0, documentado en `CLAUDE.md`). El vendedor queda bloqueado sin explicación.

---

### P3 — CRÍTICO: No hay portfolio — los tokens "desaparecen"

**Severidad:** Alta — destruye confianza
**Archivos:** No existe; ticket T9.7 marcado pendiente
**Causa raíz:** Cuando un farmer commitea su token al Head, el token desaparece de su wallet L1. No hay página donde el usuario pueda verificar qué tiene dentro del Head ni qué tiene en L1.

---

### P4 — SIGNIFICATIVO: Tiempos de espera sin feedback

**Severidad:** Media — parece roto para usuarios nuevos
**Archivos:** `frontend/app/sell/SellForm.tsx`, `frontend/app/listings/[id]/BuySection.tsx`
**Causa raíz:** Las operaciones L1 (commit, mint) tardan 20-60s. No hay indicadores de progreso, ni mensajes explicativos, ni estimaciones de tiempo.

---

### P5 — SIGNIFICATIVO: El flujo de compra no tiene recibo

**Severidad:** Media
**Archivos:** `frontend/app/listings/[id]/BuySection.tsx`
**Causa raíz:** El buyer hace clic en "Comprar", el backend envía la tx al Head (confirmación instantánea), y la UI solo recarga el listing mostrando "sold". No hay recibo, no hay txId visible, no hay confirmación de que el token llegó a la wallet del comprador.

---

### P6 — SIGNIFICATIVO: Recover de escrow hardcodeado

**Severidad:** Media — falla para cualquier usuario que no sea el de demo
**Archivos:** `frontend/app/sell/SellForm.tsx` (CBOR y txId hardcodeados)
**Causa raíz:** Si un escrow queda atascado en la script address, la UI tiene una ruta de recuperación con valores hardcodeados del usuario de prueba. Cualquier otro usuario con un escrow atascado no tiene forma de recuperar sus tokens.

---

### P7 — MODERADO: La UI usa polling cuando el Head es tiempo real

**Severidad:** Media
**Archivos:** `frontend/app/page.tsx` (`revalidate: 5`), `frontend/app/listings/[id]/page.tsx` (`revalidate: 3`)
**Causa raíz:** Los listings se refrescan cada 3-5 segundos con revalidación de Next.js. Dentro del Hydra Head las confirmaciones son instantáneas (~1s). La UI debería usar Server-Sent Events para reflejar el estado real.

---

### P8 — MODERADO: El KYC tiene un cuello de botella humano

**Severidad:** Media
**Archivos:** `backend/src/api/farmers.ts`, `backend/src/api/admin.ts`, `frontend/app/identity/KycForm.tsx`
**Causa raíz:** El farmer envía su hash de KYC → un admin humano lo aprueba manualmente → el admin minta el FarmerPass en L1 y pega el tx hash en el panel. Sin SLA ni notificación al farmer. Si el admin no actúa, el farmer queda bloqueado indefinidamente.

---

### P9 — MODERADO: Fees L1 no mostrados antes de firmar

**Severidad:** Baja-Media
**Archivos:** `frontend/app/sell/SellForm.tsx`, `frontend/app/identity/CropMintForm.tsx`
**Causa raíz:** Las transacciones L1 (commit, mint de CropToken, KYC) tienen fees que no se muestran al usuario antes de que firme. El usuario no sabe cuánto pagará.

---

### P10 — MODERADO: La página /status expone internals de Hydra

**Severidad:** Baja
**Archivos:** `frontend/app/status/page.tsx`
**Causa raíz:** La página muestra "Hydra Head", headId hexadecimal, estado de conexión WS. Para usuarios normales no tiene sentido. Debería ser acceso admin-only o abstraerse como "Estado del marketplace".

---

## 2. Roadmap

Las fases están ordenadas por dependencia. Cada fase puede ejecutarse de forma independiente una vez que la anterior está completa.

---

### ✅ Fase 0 — Prerequisito operacional (sin cambios de código)

**Objetivo:** El operador mantiene un Head siempre abierto, financiado solo con su ADA.
**Por qué primero:** Las fases 1 y 2 no tienen sentido si el Head sigue cerrándose y reabrándose por sesión de trading.

**Pasos:**
1. El operador ejecuta `POST /api/head/init` una sola vez.
2. Ejecuta `hydra/scripts/commit.sh` solo con ADA del operador (sin token de farmer).
3. Ejecuta `POST /api/head/collect` → Head abre con ADA del operador solamente.
4. Ejecuta `POST /api/head/split-ada` → dos UTxOs de ADA para collateral y buyer input.
5. El Head permanece abierto indefinidamente. Solo se cierra/reabre en mantenimiento.

**Archivos:** Ninguno. Solo operacional.
**Decisión pendiente:** Ver nota arquitectural en Sección 3.

---

### ✅ Fase 1 — Portfolio: visibilidad de activos

**Objetivo:** El usuario puede ver qué tiene en L1 y qué tiene dentro del marketplace en cualquier momento.

**Backend:**
- `GET /api/wallet/balance/:address` — lista UTxOs del usuario en el Head snapshot.
  - Ya implementado en `backend/src/api/wallet.ts` (creado en sesión anterior; registrar en router si no está).
  - Retorna: `{ utxos, totalLovelace, headStatus }`.
- `GET /api/wallet/l1-balance/:address` — lista UTxOs del usuario en L1 via Blockfrost.
  - Usar `config.blockfrostUrl` + `config.blockfrostApiKey` (ya en `backend/src/config.ts`).

**Frontend:**
- Nueva página `/portfolio`.
- Dos secciones: "En el marketplace" (UTxOs en Head) y "En tu wallet" (UTxOs L1).
- No mencionar "Hydra", "Head", "L2". Usar "en el marketplace" / "en tu wallet".

**Sin hardcoding:** Toda la data viene de los endpoints dinámicos, nunca de valores fijos.

---

### ✅ Fase 2 — Desacoplar listing del Head lifecycle

**Objetivo:** El vendedor solo ve: seleccionar token → precio → firmar → publicado.

**Cambios en `SellForm.tsx`:**
- Eliminar secciones: "Commit al Head", "Abrir Head (Collect)", "Dividir ADA".
- Eliminar indicadores de estado del Head (Idle/Initializing/Open).
- El flujo queda: `seleccionar token de su wallet` → `ingresar precio` → `firmar escrow tx` → `publicado`.

**Prerequisito:** Fase 0 completada (Head siempre abierto).
**Decisión arquitectural requerida:** Ver Sección 3.

**Sin hardcoding:** El endpoint `GET /api/crops/:address` ya devuelve los tokens del farmer dinámicamente. La selección de token no cambia.

---

### ✅ Fase 3 — Feedback de transacciones

**Objetivo:** Ninguna operación parece "rota". El usuario sabe qué está pasando en cada momento.

**Reglas de mensaje:**
- Nunca mencionar: "Hydra", "Head", "L1", "L2", "commit", "snapshot", "UTxO", "lovelace".
- Usar: "Publicando…", "Confirmando pago…", "Procesando…", "¡Listo!".

**`SellForm.tsx`:**
- Spinner + mensaje mientras se construye y firma el escrow tx.
- Estado final: "Tu token está publicado en el marketplace".

**`BuySection.tsx`:**
- Post-compra: mostrar recibo con mensaje "¡Compra exitosa!", nombre del token, precio pagado.
- Opcionalmente mostrar txId abreviado (no el hash completo) como referencia.

**`CropMintForm.tsx`:**
- Estimación de fee L1 antes de firmar (usando `cardano-cli transaction calculate-min-fee` o valor fijo + advertencia).

---

### ✅ Fase 4 — Actualizaciones en tiempo real

**Objetivo:** Los listings reflejan cambios en <2s sin polling.

**Backend:**
- El endpoint `GET /api/events` ya existe (`createEventsRouter` en `backend/src/api/router.ts`).
- Extenderlo para Server-Sent Events (SSE): emite `listing_sold`, `listing_created`, `listing_cancelled` cuando el `eventStore.ts` procesa los eventos Hydra.

**Frontend:**
- `frontend/app/page.tsx`: reemplazar `revalidate: 5` por `useEffect` con `EventSource` al endpoint SSE.
- `frontend/app/listings/[id]/page.tsx`: reemplazar `revalidate: 3` por SSE o polling cada 1s solo cuando hay una compra pendiente.

**Sin hardcoding:** Los eventos vienen del WS de Hydra vía `eventStore.ts` → SSE → frontend. No hay timers fijos.

---

### ✅ Fase 5 — KYC sin bloqueo de admin

**Objetivo:** Un farmer puede completar el KYC y empezar a operar en el mismo día, sin depender de que un admin esté disponible.

**Opción mínima (recomendada para MVP):**
- En `KycForm.tsx`: mostrar mensaje claro con SLA estimado ("Tu registro será revisado en menos de 24 horas").
- En `backend/src/api/admin.ts`: agregar endpoint `POST /api/admin/farmers/auto-approve` que el operador puede invocar via cron o script, aprobando registros pendientes mayores a N horas.
- No requiere cambios de seguridad — el endpoint ya requiere `x-admin-key`.

**Opción futura:** Verificación automática del hash de identidad contra registros externos. Fuera del alcance del MVP.

---

### ✅ Fase 6 — Recover dinámico (sin hardcoding)

**Objetivo:** Cualquier usuario con un escrow atascado puede recuperar su token, no solo el usuario de demo.

**Backend:**
- `GET /api/listings/my-escrows/:sellerAddress` — busca UTxOs en la script address cuyo datum tenga `seller == sellerAddress`.
  - Usa `hydra.getUtxos()` + filtro por `address == config.scriptAddress` + decodificación del datum.

**Frontend (`SellForm.tsx`):**
- Reemplazar el bloque hardcodeado de recovery por una llamada a `GET /api/listings/my-escrows/:address`.
- Si devuelve UTxOs atascados → mostrar botón "Recuperar token" dinámicamente.
- Si no hay UTxOs atascados → no mostrar nada.

---

### ✅ Fase 7 — Deposit directo desde portfolio (Hydra v1.3.0)

**Objetivo:** El farmer deposita su token desde la UI sin cerrar el marketplace. Habilitado por el fix de incremental commits en Hydra v1.3.0.

**Implementado (2026-03-30):**
- `POST /api/wallet/deposit` — construye blueprintTx + llama Hydra `/commit` → devuelve `commitTxCbor`
- `POST /api/wallet/submit-l1-tx` — envía tx firmada a L1 via Blockfrost
- `POST /api/wallet/withdraw` — solicita decommit de un UTxO del Head
- `frontend/app/portfolio/page.tsx` — botón "Depositar al marketplace" en UTxOs con tokens, "Retirar" en UTxOs del Head, estado "En tránsito", auto-refresh SSE

**Flujo completo:**
```
Wallet L1 (token) → click "Depositar" → commitTxCbor → wallet firma → Blockfrost submit
  → Hydra v1.3.0 detecta depositTx → CommitFinalized SSE
  → Portfolio auto-refresh → token aparece en "Fondos en el marketplace"
  → Toast: "Token disponible"
  → /sell → publicar → vender
```

---

### ✅ Fase 8 — Dashboard de productor + sistema de toasts

**Objetivo:** Vista centralizada para el farmer + notificaciones en tiempo real sin depender del estado del Head.

**Implementado (2026-03-30):**
- `GET /api/farmers/stats/:address` — active_listings, total_sold, total_revenue, últimas 5 ventas
- `frontend/app/dashboard/page.tsx` — stats grid, listados activos, últimas ventas, badge marketplace, acciones rápidas
- `frontend/components/ToastProvider.tsx` — toasts SSE-driven: CommitFinalized, DecommitFinalized, FarmerApproved, HeadIsClosed/Open, hydra:connected/disconnected
- Navbar: link "Dashboard" agregado
- Tailwind: animación `fade-in` + colores `hydra-400/700/800`

---

## 3. Nota arquitectural — Decisión pendiente para Fase 2 (RESUELTA)

La Fase 2 (desacoplar listing del Head lifecycle) requiere resolver cómo los tokens de farmers llegan al Head sin que el farmer ejecute el commit.

### Opción A — Escrow directo dentro del Head (recomendada)

El operador abre el Head solo con su ADA. Cuando un farmer quiere listar, firma una transacción **dentro del Head** que mueve su token (ya en el Head) a la script address. El token llega al Head por un commit combinado hecho de antemano por el operador.

**Problema:** requiere que el token esté en el Head antes de que el farmer pueda listarlo. Vuelve al problema del commit combinado.

### Opción B — Escrow L1 con movimiento al Head por el operador

El farmer firma un escrow en L1. El operador (backend) detecta el escrow L1 y construye una transacción que mueve el token al Head automáticamente.

**Problema:** requiere custodia L1 + lógica adicional en el backend.

### Opción C — Commit automático por el operador (más simple)

El operador hace un commit combinado en nombre del farmer, pero el proceso es completamente transparente para el usuario: el farmer solo firma la transacción que el operador construye en el backend, y el frontend lo presenta como "Publicar token". El flujo técnico (commit clásico) se mantiene, pero la UI lo abstrae completamente.

**Esta es la opción de menor riesgo:** no cambia la arquitectura técnica, solo la presentación en la UI.

---

## 4. Prioridades y dependencias

```
Fase 0 (operacional)
    └── Fase 1 (portfolio) — independiente, puede hacerse en paralelo
    └── Fase 2 (desacoplar listing) — requiere Fase 0 + decisión arquitectural
            └── Fase 3 (feedback) — mejora sobre Fase 2
                    └── Fase 4 (real-time) — mejora sobre Fase 3
    └── Fase 5 (KYC) — independiente
    └── Fase 6 (recover dinámico) — independiente
```

**Secuencia ejecutada:** 0 → 1 → 6 → 3 → 2 → 4 → 5 → 7 → 8 ✅ todas completas

**Pendiente operacional:**
- Cerrar Head actual → Fanout → re-init con Hydra v1.3.0 scripts
- Probar incremental commit end-to-end con token real de farmer
