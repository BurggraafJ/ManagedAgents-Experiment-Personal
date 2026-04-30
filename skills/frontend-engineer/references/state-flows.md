# State Flows — Antwoord-Flow, Streaming & Component-Timing

Dit document beschrijft exact hoe de LegalMind frontend een vraag-antwoord cyclus afhandelt:
welke componenten wanneer renderen, in welke volgorde, met welke timing, en hoe de state
door de hele flow heen verandert. **Dit is het referentiedocument om te voorkomen dat je
buggy scroll-gedrag, haperende animaties of verkeerde component-volgorde bouwt.**

---

## Inhoudsopgave

1. [Overzicht: Twee modules, twee flows](#1-overzicht-twee-modules-twee-flows)
2. [SSE Streaming Engine](#2-sse-streaming-engine)
3. [Assistant Module: Initiële vraag](#3-assistant-module-initiële-vraag)
4. [Assistant Module: Vervolgvraag](#4-assistant-module-vervolgvraag)
5. [Assistant Module: SSE Event Types & Verwerking](#5-assistant-module-sse-event-types--verwerking)
6. [Case/Dossier Module: Initiële vraag](#6-casedossier-module-initiële-vraag)
7. [Case/Dossier Module: Vervolgvraag](#7-casedossier-module-vervolgvraag)
8. [Case Module: SSE Event Types & Verwerking](#8-case-module-sse-event-types--verwerking)
9. [Scroll-gedrag: COMPLEET overzicht](#9-scroll-gedrag-compleet-overzicht)
10. [Component Render-Volgorde & Timing](#10-component-render-volgorde--timing)
11. [Bronnen/Referenties: Wanneer & Hoe](#11-bronnenreferenties-wanneer--hoe)
12. [Loading States & Animaties](#12-loading-states--animaties)
13. [Error Handling per State](#13-error-handling-per-state)
14. [Zustand Store: Velden & Reset-Gedrag](#14-zustand-store-velden--reset-gedrag)
15. [ALLE Timing-Constanten (volledig)](#15-alle-timing-constanten-volledig)
16. [ALLE useEffect hooks die scroll/timing beïnvloeden](#16-alle-useeffect-hooks-die-scrolltiming-beïnvloeden)
17. [Checklist: Wat kan misgaan](#17-checklist-wat-kan-misgaan)
18. [Verschil Assistant vs Case Module](#18-verschil-assistant-vs-case-module)
19. [CSS Animaties (volledig)](#19-css-animaties-volledig)
20. [Inactieve/Voorbereide Componenten](#20-inactievevoorbereide-componenten)
21. [Bestanden-Referentie](#21-bestanden-referentie)

---

## 1. Overzicht: Twee modules, twee flows

LegalMind heeft twee chat-modules die **verschillende** antwoordflows gebruiken:

| Aspect | Assistant Module | Case/Dossier Module |
|--------|-----------------|---------------------|
| **Pages** | `AssistantNew.tsx` → `AssistantSession.tsx` | `Case.tsx` → `RightContentEmpty.tsx` / `RightContentSession.tsx` |
| **Streaming hook** | `useSSEQuery` (GET-based, auto-start) | `useSSEQuery` (GET-based, auto-start) |
| **Store** | `useAssistantStore` (5 slices) | `useCaseStore` (7 slices) |
| **Sessie-creatie** | Navigate naar `/assistant/:sessionId` | URL param `?session=:id` |
| **Bronnen in markdown** | `remarkEcliParser`, `remarkLawParser`, `remarkEurlexParser` | `remarkEcliParser`, `remarkLawParser` + `rehypeSourceParser` voor documenten |
| **Document-context** | Geen (globale bronnen) | `label_dict` per bericht (welke documenten geselecteerd) |
| **Bronnen-sidebar** | Laws + Verdicts + Eurlex | Documents + Laws + Verdicts |

**Kritiek verschil:** De Assistant module toont bronnen uit juridische databases. De Case module
toont daarnaast ook documentbronnen uit de geselecteerde dossierbestanden, met `label_dict`
tracking per bericht.

**Let op: DocCaseChat.tsx** — Er bestaat ook een OUDERE case chat implementatie die nog actief
is in sommige views. Deze gebruikt `useSSEMutation` (POST) ipv `useSSEQuery` (GET), en slaat
berichten op in localStorage ipv Zustand. Timing-waarden wijken af (0ms ipv 100ms delays).

---

## 2. SSE Streaming Engine

### Architectuur

Alle streaming gaat via `SSEStreamManager` (singleton per queryKey) die de `@microsoft/fetch-event-source`
library gebruikt.

**Bestanden:**
- `hooks/sseUtils.ts` — Core `SSEStreamManager` class
- `hooks/useSSEQuery.ts` — GET-based streaming hook (voor session streams)
- `hooks/useSSEMutation.ts` — POST-based streaming hook (voor directe chat)

### Hoe tokens binnenkomen

```
Server stuurt SSE events → fetchEventSource ontvangt → parseMessage() → emit() → subscribers notified
```

1. **Elk SSE event = één callback** — geen batching, geen debouncing
2. Server stuurt JSON objecten als `data:` lines: `{"type": "text", "value": "token"}`
3. `parseMessage()` doet `JSON.parse()` op elke `data:` line
4. `emit()` pusht naar `events[]` array en notifieert alle subscribers onmiddellijk
5. React batcht `setState` calls intern als ze in dezelfde callback zitten

### Levenscyclus van een stream

```
start() → reset events → isStreaming=true → notifyStatus()
  ↓
onmessage per event → parseMessage → emit → subscribers
  ↓
onclose / stream eindigt → isStreaming=false → notifyStatus()
```

### Manager overleeft unmounts

- Managers zijn **global singletons** per queryKey (Map in sseUtils.ts)
- Component unmount stopt de stream NIET (tenzij `cancelOnUnmount: true`)
- Bij remount: alle eerdere events worden **gereplayd** met `isReplay: true`
- `answer_inc` events worden NIET gereplayd (check `if (!isReplay)`)
- `answer` events worden WEL gereplayd (bevatten volledige tekst tot dat punt)

### Cancellation

```typescript
manager.cancel()
  → cancelRequested = true
  → abortController.abort()
  → reset() (clear alle events)
  → isStreaming = false
```

### Enabled conditions (wanneer start SSE?)

**Assistant:** `!!sessionId && fetchSessionStream && !isSessionLoading && !(isSessionStale && isSessionFetching)`

**Case:** `!!caseId && !!sessionId && !!sessionData && fetchSessionStream && !isSessionLoading && !isAskingQuestion`

**Case heeft extra guard:** `!isAskingQuestion` — voorkomt dat SSE start terwijl de vraag-mutation nog loopt.

---

## 3. Assistant Module: Initiële vraag

### Stap-voor-stap flow

```
STAP 1: Gebruiker typt vraag op AssistantNew pagina
         Component: MainQueryInput
         Bestand: pages/AssistantNew.tsx

STAP 2: onSendMessage() wordt aangeroepen
         ↓
         createNewSessionMutation triggert:

         [onMutate fase - DIRECT]
         • newQuestionCleanup() → reset sessionMessages=[], sources, errors
         • API call: POST /api/assistant/session { query, sources }

         [onSuccess fase - NA API RESPONSE]
         • Ontvangt { session_id, status, messages }
         • setFetchSessionStream(true) → activeert SSE
         • setQuery("") → leegt input
         • navigate(`/assistant/${session_id}`) → PAGINA NAVIGATIE

STAP 3: AssistantSession pagina mount
         Bestand: pages/AssistantSession.tsx
         ↓
         • useQuery haalt sessie-data op (GET /api/assistant/session/:id)
         • useEffect op sessionData: als status="processing" → setFetchSessionStream(true)
         • als status="streaming" → setFetchSessionStream(true)
         • als status="completed" → setFetchSessionStream(false), setSessionMessages(data.messages)

STAP 4: useSSEQuery activeert (enabled wordt true)
         queryKey: ["assistantSessionStream", sessionId]
         url: /api/assistant/session/:id/stream
         ↓
         SSE verbinding start, events komen binnen (zie sectie 5)

STAP 5: Streaming events vullen sessionMessages
         • "question" → findOrCreateMessageById(id, text)
         • "answer" / "answer_inc" → appendAnswerToMessageById(id, text)
         • "sources" → setMessageSourcesById(id, {...})
         • "done" → setFetchSessionStream(false), refetchSessionDataDelayed()

STAP 6: Stream eindigt
         • isStreaming wordt false
         • 500ms later: refetchSessionData() voor definitieve state
         • checkAndScroll() na 100ms
```

---

## 4. Assistant Module: Vervolgvraag

### Stap-voor-stap flow

```
STAP 1: Gebruiker typt vervolgvraag in MainQueryInput (sticky bottom)
         Bestand: pages/AssistantSession.tsx, regel 484-486

STAP 2: askAssistantSessionQuestionMutation.mutate(question)

         [onMutate fase - DIRECT, t=0ms]
         • setQuery("") → input leeg
         • setSessionError(null)
         • Nieuw bericht OPTIMISTISCH toegevoegd aan sessionMessages:
           { id: length+1, question: text, answer: null, sources: {}, ... }
         • setTimeout(() => scrollToBottom(), 100) → scroll na 100ms

         [mutationFn - t=0-500ms]
         • POST /api/assistant/session/:id/question { question, sources }

         [onSuccess - NA API RESPONSE]
         • setSessionMessages(data.messages) → berichten bijgewerkt
         • setFetchSessionStream(true) → SSE streaming start
         • queryClient cache update

         [onError - BIJ FOUT]
         • setQuery(question) → vraag terug in input
         • Laatste bericht krijgt error state

STAP 3: useSSEQuery activeert opnieuw
         • Zelfde queryKey maar nieuwe stream
         • Events komen binnen, vullen het nieuwe bericht

STAP 4: Component re-renders
         • AssistantSessionChatArea.tsx rendert alle berichten
         • Nieuw bericht verschijnt met UserChatMessage (vraag)
         • Daarna AssistantChatMessage met streaming antwoord
```

### Kritieke timing bij vervolgvraag (GEDETAILLEERD)

```
t=0ms      Mutation onMutate triggert:
             → setSessionMessages([...prev, newMsg])   // State update (answer=null)
             → setQuery("")                            // Input leeg
             → setTimeout(scrollToBottom, 100)         // Scroll gepland

t=0-16ms   React batch-rendert:
             → UserChatMessage verschijnt (animate-fade-in, 300ms)
             → AssistantChatMessage met loading=true (ProfilePictureLoading spinner)
             → useEffect [sessionMessages, checkAndScroll] vuurt NIET (isStreaming=false)

t=100ms    scrollToBottom() vuurt (vanuit onMutate setTimeout):
             → container.scrollTo({ top: scrollHeight })  // INSTANT (smooth uitgecomment)
             → isScrollingProgrammatically = true          // Flag aan
             → setTimeout(resetFlag, 500)                  // Reset na 500ms

t=~300ms   API response onSuccess:
             → setSessionMessages(data.messages)           // Update met backend data
             → setFetchSessionStream(true)                 // SSE activeert

t=~300ms   useEffect [isStreaming] triggert in useStreamingAutoScroll:
             → allowAutoScrollRef.current = true           // Scroll heractiveerd

t=~500ms   Eerste SSE events binnenkomen:
             → appendAnswerToMessageById()                 // sessionMessages update
             → useEffect [sessionMessages, checkAndScroll] triggert
             → checkAndScroll() → throttled scrollToBottom()

t=500ms    resetProgrammaticFlag (vanuit t=100ms scroll):
             → isScrollingProgrammatically = false         // Scroll events weer getrackt

t=variabel Per token (~10-50ms interval server-side):
             → appendAnswerToMessageById()
             → useEffect triggert → checkAndScroll() → throttled (max 1x per 100ms)

t=variabel "sources" event:
             → setMessageSourcesById() → bronnen verschijnen in tekst

t=variabel "done" event:
             → setFetchSessionStream(false) → isStreaming wordt false
             → setTimeout(checkAndScroll, 100)             // Laatste scroll
             → setTimeout(refetchSessionData, 500)         // Backend sync
```

**Er zit een gap van ~300-500ms** tussen het verschijnen van de vraag en het begin van
het antwoord. In die tijd toont het component de loading state (ProfilePictureLoading spinner).

### Wat verandert er bij korte vs. lange antwoorden?

De flow is identiek, maar de BELEVING verschilt sterk:

**Kort antwoord (~1-3 seconden, paar tokens):**
```
t=0ms      Vraag verschijnt + loading spinner
t=100ms    Scroll naar beneden
t=~500ms   SSE start, eerste tokens
t=~500ms   Loading spinner verdwijnt (answer !== null), tekst zichtbaar
t=~1-3s    "sources" event → bronnen verschijnen inline
t=~1-3s    "done" → isStreaming=false
             → MessageInteractionButtons + Feedback + ShowSourcesButton verschijnen
             → Alles zichtbaar zonder te scrollen
```
- Loading spinner nauwelijks zichtbaar (~200ms)
- Gebruiker ziet bijna direct het volledige antwoord
- Scroll is niet nodig (antwoord past op scherm)
- Bronnen verschijnen nagenoeg gelijktijdig met tekst

**Lang antwoord (~20-60 seconden, veel tokens):**
```
t=0ms      Vraag verschijnt + loading spinner
t=100ms    Scroll naar beneden
t=~500ms   SSE start, eerste tokens
t=~500ms   Loading spinner verdwijnt, tekst begint te groeien
t=500ms+   Per ~10-50ms komt een token binnen:
             → sessionMessages update
             → useEffect triggert checkAndScroll()
             → Throttled: max 1x per 100ms → ~10 scrolls/seconde
             → Tekst groeit, pagina scrollt mee
t=~10-30s  "sources" event → bronnen verschijnen TUSSENDOOR in tekst
             (remark plugins re-renderen de markdown met bron-tags)
t=~20-60s  "done" → isStreaming=false
             → Alle interaction buttons verschijnen
             → Laatste checkAndScroll() na 100ms
             → refetchSessionData() na 500ms
```
- Loading spinner ~200ms zichtbaar
- Tekst groeit geleidelijk, ~10 scroll-updates per seconde
- **Gebruiker kan tussendoor omhoog scrollen** → auto-scroll stopt
- Bronnen verschijnen mogelijk halverwege het antwoord
- Interaction buttons pas HELEMAAL aan het einde
- Als gebruiker omhoog scrollde: moet zelf terug naar beneden scrollen
  (of tot binnen threshold van bodem → auto-scroll hervat)

**Wat NIET verandert tussen kort en lang:**
- Component render-volgorde is identiek
- Loading spinner logica is identiek
- Spacing (80px tussen paren, 16px binnen paar) is identiek
- Scroll-mechanisme is identiek (alleen frequentie verschilt)
- Bronnen verschijnen altijd via "sources" event (timing is backend-bepaald)

**Waar een AI-engineer op moet letten:**
- Als je een component toevoegt dat na het antwoord verschijnt (bijv. vervolgvragen),
  moet het werken ongeacht of het antwoord 1 seconde of 60 seconden duurt
- De `!isStreaming` check is de juiste guard — deze wordt pas false bij "done"
- Als je iets toevoegt dat TIJDENS streaming zichtbaar moet zijn, moet het tegen
  ~10 re-renders per seconde kunnen (memo het!)

### Hoe verschilt dit in de Case/Dossier module?

De Case module heeft een paar concrete verschillen in de tijdlijn:

**Loading state:** De Case module toont een ANDERE loading tekst:
- Assistant: "Legal Mind voert een uitgebreide analyse uit" + "Dit process duurt gemiddeld 20 tot 30 seconden"
- Case: **"Legal Mind analyseert het dossier"** + **"Dit kan even duren..."** (CaseMessage.tsx:166-169)

**Loading conditie verschilt:**
- Assistant: `isStreaming && (!lastMessage || !lastMessage.answer) && index === lastIndex`
- Case: `!message.answer && isLastMessage` (simpeler, CaseMessage.tsx:160)
- Case ChatArea: `item.answer || isStreaming || (isLastMessage && showLastMessageLoading)` (CaseSessionChatArea.tsx:197)
- Case `showLastMessageLoading`: `isStreaming || isAskingQuestion || isPendingFirstQuestion` (RightContentSession.tsx:532)

Dit betekent: in de Case module blijft de loading state ook zichtbaar terwijl de vraag-mutation
nog loopt (`isAskingQuestion`), niet alleen tijdens streaming. De loading verdwijnt pas als
`message.answer` gevuld wordt (eerste token).

**Bronnen verschijnen anders:**
- Assistant: bronnen worden per-bericht gezet via `setMessageSourcesById(msg_id, value)`.
  De remark plugins zijn memo'd op `currentMessage.sources` (scroll-positie afhankelijk).
- Case: bronnen worden SESSIE-BREED gezet via `setSessionSources(...)`. Alle berichten
  delen dezelfde bronnenpool. De rehype plugins gebruiken `sessionSources` + `currentLabelDict`.

**Concrete consequentie bij lang antwoord:**
In de Case module kan het "sources" event extra rehype plugins activeren die document-referenties
renderen. Dit voegt DOM-elementen toe (klikbare bronlabels) wat de hoogte van het bericht
verandert TIJDENS streaming. De scroll-throttle (100ms) vangt dit op, maar er kan een
micro-sprong zijn als veel bronnen tegelijk verschijnen.

**refetchDelay verschilt:** Assistant 500ms, Case 1000ms. Dit betekent dat na een lang
antwoord in de Case module de definitieve state 500ms LATER beschikbaar is dan in Assistant.

---

## 5. Assistant Module: SSE Event Types & Verwerking

### Event Types

```typescript
type SessionStreamEvent =
  | { type: "question";    msg_id: number; value: string }    // Vraagtekst
  | { type: "answer";      msg_id: number; value: string }    // Antwoord chunk
  | { type: "answer_inc";  msg_id: number; value: string }    // Incrementeel token
  | { type: "sources";     msg_id: number; value: Sources }   // Bronnen object
  | { type: "done";        msg_id: number; value: string }    // Stream klaar
  | { type: "error";       msg_id: number; value: string }    // Fout
```

### Verwerkingslogica (AssistantSession.tsx:151-196)

```
"question"   → findOrCreateMessageById(msg_id, value)
                Maakt nieuw bericht als msg_id niet bestaat, update vraag als wel

"answer"     → appendAnswerToMessageById(msg_id, value)
                Eerste keer: answer wordt value (was null)
                Daarna: answer += value (string concatenatie)
                WORDT WEL gereplayd bij remount

"answer_inc" → if (!isReplay) appendAnswerToMessageById(msg_id, value)
                ALLEEN bij live events, NIET bij replay
                Voorkomt dubbele tekst bij remount

"sources"    → setMessageSourcesById(msg_id, value)
                VERVANGT alle bronnen voor dit bericht
                value = { answer_laws: [], answer_verdicts: [], answer_eurlex: [] }

"done"       → setFetchSessionStream(false)
                refetchSessionDataDelayed() (500ms delay)
                setTimeout(() => checkAndScroll(), 100)

"error"      → setMessageErrorById(msg_id, value)
                setFetchSessionStream(false)
                refetchSessionDataDelayed()
```

### Volgorde van events (typisch)

```
1. "question"     (bevestigt de vraag)
2. "answer" / "answer_inc" × N  (tokens, ~10-50ms interval)
3. "sources"      (bronnen na alle tekst, of tussendoor)
4. "done"         (stream eindigt)
```

**Belangrijk:** "sources" kan ook TIJDENS het streamen binnenkomen, niet alleen erna.

---

## 6. Case/Dossier Module: Initiële vraag

### Stap-voor-stap flow

```
STAP 1: Gebruiker selecteert documenten in linker sidebar
         Component: CaseDocumentTab
         Store: selectedFileIds[] in CaseDocumentTabSlice

STAP 2: Gebruiker typt vraag in MainQueryInput
         Component: components/case/MainQueryInput.tsx (ANDERE dan assistant!)
         Validatie: selectedFileIds.length > 0 vereist

STAP 3: handleSendMessage() in RightContentEmpty.tsx
         ↓
         [DIRECT]
         • Optimistisch bericht: setSessionMessages([{ id:0, question, answer:null, ... }])
         • setIsPendingFirstQuestion(true)

         createSessionMutation:
         • POST /api/case/:caseId/session { question, documents: [...], useAssistant }
         • documents = [{ id, name, unique_identifier }] per geselecteerd bestand

         [onSuccess]
         • navigate naar /case/:caseId?session=:sessionId
         • RightContentSession mount

STAP 4: RightContentSession mount
         Bestand: components/case/RightContentSession.tsx
         ↓
         • useQuery: GET /api/case/:caseId/session/:sessionId
         • Bij status="processing"/"streaming" → setFetchSessionStream(true)
         • useSSEQuery activeert: /api/case/:caseId/session/:sessionId/stream

STAP 5: Streaming events (zie sectie 8)
```

---

## 7. Case/Dossier Module: Vervolgvraag

### Flow

```
STAP 1: Gebruiker kan documentselectie WIJZIGEN tussen vragen
         Elke vraag slaat eigen label_dict op

STAP 2: handleSendMessage() in RightContentSession.tsx
         ↓
         • Validatie: selectedFileIds.length > 0
         • askQuestionMutation({ question, documents, useAssistant })

         [onMutate]
         • Optimistisch bericht toevoegen
         • setTimeout(() => scrollToBottom(), 100)

         [onSuccess]
         • setFetchSessionStream(true)

STAP 3: SSE streaming start
         Events verwerkt via msg_id routing (zie sectie 8)
```

### msg_id routing (complex)

De Case module heeft complexere **msg_id routing** omdat:
- Backend stuurt msg_id als lineaire index (0, 1, 2, 3...)
- Oneven indices = antwoorden, even = vragen
- Bij errors kan de mapping verspringen
- `backendMsgIdToPairIndex[]` array mapt backend IDs naar frontend paar-indices
- `resolveStreamTargetPairIndex()` vangt edge cases op

---

## 8. Case Module: SSE Event Types & Verwerking

### Event Types

```typescript
type CaseSessionStreamEvent =
  | { type: "question";  msg_id: number; value: string }
  | { type: "text";      msg_id: number; value: string }      // LET OP: "text" niet "answer"
  | { type: "sources";   msg_id: number; value: CaseSources }
  | { type: "labeldict"; msg_id: number; value: Record<string, DocumentLabel> }
  | { type: "done";      msg_id: number; value: string }
  | { type: "error";     msg_id: number; value: string }
```

### Verwerkingslogica (RightContentSession.tsx:280-366)

```
"question"   → getPairIndexForMsgId(msg_id) → findOrCreateMessageById(pairIndex, value)

"text"       → getPairIndexForStreamAnswer(msg_id) → resolveStreamTargetPairIndex()
                → appendAnswerToMessageById(targetIndex, value)
                NIET bij replay (if isReplay return)

"sources"    → setSessionSources({ documents, assistant_laws, assistant_verdicts })
                Dit zijn SESSIE-BREDE bronnen, niet per-bericht
                + setMessageSourcesById() per bericht

"labeldict"  → setMessageLabelDictById(targetIndex, value)
                Welke documenten zijn gebruikt voor dit antwoord
                Toont als dropdown boven het bericht

"done"       → setFetchSessionStream(false)
                streamCompletedRef.current = true
                refetchSessionDataDelayed()
                setTimeout(() => checkAndScroll(), 100)

"error"      → setMessageErrorById(targetIndex, value)
                setFetchSessionStream(false)
```

---

## 9. Scroll-gedrag: COMPLEET overzicht

### De useStreamingAutoScroll hook

**Bestand:** `hooks/useStreamingAutoScroll.ts`

Dit is het CENTRALE scroll-mechanisme. Begrijp deze hook volledig voordat je iets
aan de chat UI wijzigt.

### ALLE scroll-triggers (volledig overzicht)

#### Assistant Module (AssistantSession.tsx)

| # | Trigger | Functie | Delay | Regel | Wanneer |
|---|---------|---------|-------|-------|---------|
| 1 | Vervolgvraag onMutate | `scrollToBottom()` | 100ms | 227-229 | Direct na optimistisch bericht |
| 2 | SSE "done" event | `checkAndScroll()` | 100ms | 181-183 | Wanneer stream klaar is |
| 3 | **useEffect [sessionMessages, checkAndScroll]** | `checkAndScroll()` | 0ms | **339-343** | **Bij ELKE sessionMessages wijziging tijdens streaming** |
| 4 | Session geladen (mount) | `scrollToBottom()` | 100ms | 331-337 | Wanneer isSessionLoading false wordt |
| 5 | ChatArea mount | `scrollTo({ behavior: "smooth" })` | 0ms | ChatArea:77-84 | Bij mount/sessionId wijziging |

**KRITIEK — Trigger #3:** Dit is de PRIMAIRE scroll-driver TIJDENS streaming:

```typescript
// AssistantSession.tsx:339-343
useEffect(() => {
    if (sessionMessages && isStreaming) {
        checkAndScroll();
    }
}, [sessionMessages, checkAndScroll]);
```

Elke keer dat `appendAnswerToMessageById()` wordt aangeroepen (= elke token), wijzigt
`sessionMessages` → useEffect triggert → `checkAndScroll()` → throttled `scrollToBottom()`.

**BELANGRIJK — Trigger #5:** De ChatArea mount-scroll gebruikt `behavior: "smooth"` (WEL
smooth). Dit is ANDERS dan de streaming scroll in de hook (die smooth UITGECOMMENT heeft).
Bij mount wil je vloeiende scroll, tijdens streaming wil je instant.

#### Case Module (RightContentSession.tsx)

| # | Trigger | Functie | Delay | Regel | Wanneer |
|---|---------|---------|-------|-------|---------|
| 1 | Vraag onMutate | `scrollToBottom()` | 100ms | 262-264 | Na optimistisch bericht |
| 2 | SSE "done" event | `checkAndScroll()` | 100ms | 326-328 | Stream klaar |
| 3 | **useEffect [sessionMessages, isStreaming, checkAndScroll]** | `checkAndScroll()` | 0ms | **516-520** | **Bij messages wijziging tijdens streaming** |
| 4 | handleSendMessage | `scrollToBottom()` | 100ms | 474-476 | Na versturen |
| 5 | Session geladen | `scrollToBottom()` | 100ms | 522-528 | isSessionLoading false |
| 6 | ChatArea mount | `scrollTo({ behavior: "smooth" })` | 0ms | ChatArea:76-83 | Bij mount/sessionId wijziging |

#### DocCaseChat.tsx (OUDERE implementatie, nog actief)

| # | Trigger | Functie | Delay | Wanneer |
|---|---------|---------|-------|---------|
| 1 | onEvent "text" | `checkAndScroll()` | **0ms** (setTimeout 0) | Elke tekst-token |
| 2 | handleSendMessage | `scrollToBottom()` | **0ms** (setTimeout 0) | Na versturen |

**Let op:** DocCaseChat gebruikt `setTimeout(0)` ipv `setTimeout(100)`.

### Hook internals: scrollToBottom()

```typescript
scrollToBottom() {
    isScrollingProgrammaticallyRef.current = true;      // Flag AAN
    container.scrollTo({ top: scrollHeight });            // INSTANT scroll (smooth uitgecomment)
    setTimeout(() => {
        isScrollingProgrammaticallyRef.current = false;  // Flag UIT na 500ms
        lastScrollTopRef.current = scrollTop;             // Update positie
    }, 500);
}
```

### Hook internals: checkAndScroll()

```typescript
checkAndScroll() {
    if (!allowAutoScrollRef.current) return;             // User scrollde omhoog → skip
    if (now - lastCheck < 100ms) return;                 // Throttle: max 1x per 100ms
    scrollToBottom();                                     // Scroll!
}
```

### Hook internals: scroll event handler

```typescript
handleScroll() {
    if (isScrollingProgrammatically) return;             // Negeer eigen scroll
    if (currentScrollTop < previousScrollTop) {
        allowAutoScroll = false;                          // User scrollt OMHOOG → stop
    } else if (currentScrollTop > previousScrollTop) {
        if (isNearBottom()) {                             // User scrollt OMLAAG
            allowAutoScroll = true;                       // Dichtbij bodem → hervat
        }
    }
}
```

### Hook internals: isNearBottom()

```typescript
isNearBottom() {
    distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    return distanceFromBottom <= threshold;               // 40px assistant, 20px case
}
```

### Hook internals: streaming start reset

```typescript
useEffect(() => {
    if (isStreaming) {
        allowAutoScrollRef.current = true;               // Reset bij nieuwe stream
    }
}, [isStreaming]);
```

### Message visibility tracking (voor bronnen sidebar)

APART van auto-scroll is er scroll-tracking dat bijhoudt welk bericht zichtbaar is:

```typescript
// AssistantSessionChatArea.tsx / CaseSessionChatArea.tsx
onChatMessageAreaScroll = useCallback(() => {
    for (const [index, messageRef] of Object.entries(messageRefs.current)) {
        if (messageRef && isElementInViewport(messageRef, { top: "40%" })) {
            setCurrentVisibleMessageIndex(Number(index));
            break;
        }
    }
}, [...]);
```

- Checkt welk bericht in viewport is (40% van top)
- Update `currentVisibleMessageIndex` in store
- Beïnvloedt welke bronnen de remark plugins gebruiken
- **NIET throttled** — vuurt bij elk scroll event
- Geregistreerd via `addEventListener("scroll", ...)` in useEffect

---

## 10. Component Render-Volgorde & Timing

### Assistant Module: Component Hiërarchie

```
AssistantSession.tsx (pagina)
├── div.flex-row (hoofd container, h-full)
│   ├── div.flex-col (main content, overflow-y-auto) ← SCROLL CONTAINER (chatMessagesAreaRef)
│   │   ├── [sticky top-0 z-50] AssistantSessionTopBar
│   │   │   └── AssistantBreadcrumbs
│   │   │
│   │   ├── [conditional] LogoLoading (als sessie laadt en NIET streaming)
│   │   │
│   │   ├── [flex-1] AssistantSessionChatArea
│   │   │   └── div.py-6 [translate="no" tijdens streaming]
│   │   │       └── div.max-w-4xl.mx-auto.px-12.space-y-6
│   │   │           └── PER BERICHT (sessionMessages.map):
│   │   │               ├── div.space-y-4 [!mt-20 als index > 0] ← ref={messageRefs[index]}
│   │   │               │   ├── UserChatMessage (vraag, rechts, grijs)
│   │   │               │   │   └── animate-fade-in (300ms)
│   │   │               │   │
│   │   │               │   ├── [prose wrapper + ErrorBoundary]
│   │   │               │   │   ├── AssistantChatMessage (memo'd!)
│   │   │               │   │   │   ├── [loading=true] ProfilePictureLoading + tekst
│   │   │               │   │   │   └── [loading=false] ReactMarkdown met remark plugins
│   │   │               │   │   │       ├── <Ecli> componenten (onclick → nieuw tab)
│   │   │               │   │   │       ├── <Law> componenten (onclick → modal)
│   │   │               │   │   │       └── <EurLex> componenten (onclick → modal)
│   │   │               │   │   │
│   │   │               │   │   └── [na streaming] div.flex.items-center.justify-between.mt-4
│   │   │               │   │       ├── MessageInteractionButtons + Feedback
│   │   │               │   │       └── ShowSourcesButton
│   │   │               │   │
│   │   │               │   └── [conditional] AssistantSessionErrorComponent
│   │   │
│   │   ├── [conditional] AssistantSessionError (globaal)
│   │   │
│   │   └── [sticky bottom-0 z-50] MainQueryInput
│   │       └── QueryInputPL + SourcesButton
│   │       └── "Legal Mind kan fouten maken." disclaimer
│   │
│   └── div.sidebar (30% breedte, transition 400ms)
│       ├── [conditional] AssistantChatHistoryPanel (XOR met sources)
│       └── [conditional] SourcesSidebar (XOR met history)
│
├── AssistantSourceModal (law/eurlex detail)
├── AddToCaseModal
├── SessionDownload
└── PLSidebar (prompt library)
```

### Wanneer toont welk component?

| Component | Conditie | Timing |
|-----------|----------|--------|
| LogoLoading | `(isSessionLoading \|\| (isSessionFetching && isSessionStale)) && !isStreaming` | Bij mount tot data geladen |
| UserChatMessage | Altijd voor elk bericht | Direct bij render |
| AssistantChatMessage loading | `isStreaming && (!lastMessage \|\| !lastMessage.answer) && index === lastIndex` | Wachten op eerste token |
| AssistantChatMessage content | `item.answer \|\| isStreaming` (en niet error) | Zodra eerste token binnenkomt |
| MessageInteractionButtons | `item.answer && (index !== lastIndex \|\| !isStreaming)` | PAS na streaming klaar |
| ShowSourcesButton | Zelfde als InteractionButtons | PAS na streaming klaar |
| Feedback | Zelfde + `sessionId` beschikbaar | PAS na streaming klaar |
| Sidebar | `showChatHistory \|\| sourcesSidebarOpen` | Na klik op knop, 400ms transitie |

### Spacing tussen berichten

```css
/* Eerste bericht */
<div className="space-y-4">  /* 16px tussen vraag en antwoord */

/* Volgende berichten (index > 0) */
<div className="space-y-4 !mt-20">  /* 80px marge boven volgend Q&A paar */
```

**Dit is cruciaal:** Er zit 80px (`!mt-20`) tussen Q&A paren. Binnen een paar is het 16px.

### `translate="no"` attribuut

```typescript
<div translate={isStreaming ? "no" : undefined}>
```

Voorkomt dat de browser tekst probeert te vertalen TIJDENS streaming.
Wordt verwijderd zodra streaming stopt.

---

## 11. Bronnen/Referenties: Wanneer & Hoe

### Assistant Module

**Bronnen komen via SSE "sources" event:**

```typescript
value: {
    answer_laws: AnswerLaw[],        // Nederlandse wetten
    answer_verdicts: AnswerVerdict[], // Rechtspraak (ECLI)
    answer_eurlex: AnswerEurlex[],   // EU wetgeving
}
```

**Wanneer:** Typisch NA de tekst-tokens, VOOR "done". Maar kan ook tussendoor.

**Hoe weergegeven:**
1. **In de tekst** — ReactMarkdown met remark plugins parst patronen en rendert:
   - `<Ecli>` component → klikbaar, opent `/verdict/:ecli` in nieuw tab
   - `<Law>` component → klikbaar, opent LawModal (overlay)
   - `<EurLex>` component → klikbaar, opent EurlexModal (overlay)
2. **In de SourcesSidebar** — apart panel rechts met alle bronnen gegroepeerd
3. **Tooltips** — hover over bron-tag toont `AssistantSourceTooltipWrapper`:
   - Verschijnt bij hover
   - `hideDelay: 125ms`
   - Max hoogte 208px met scroll
   - Offset: `{ top: 10, left: 48 }`

**Belangrijk voor remark plugins:**
- `remarkPlugins` zijn `useMemo`'d op basis van `currentMessage?.sources`
- `currentMessage` is gebaseerd op `currentVisibleMessageIndex` (scroll-positie)
- Dit betekent: de remark plugins gebruiken bronnen van het ZICHTBARE bericht

### Case/Dossier Module

**Extra bron-type: documenten**

```typescript
sources: {
    documents: Record<string, Record<string, DocumentChunk>>,
    assistant_laws: Law[],
    assistant_verdicts: Verdict[],
}
```

**Plus label_dict per bericht:**
```typescript
label_dict: Record<string, { name: string, document_id: string, ... }>
```

**Hoe weergegeven:**
1. **Dropdown boven bericht** — toont welke documenten gebruikt zijn (uit label_dict)
   - Klikken opent document in FileViewer met page numbers
2. **In de tekst** — rehype plugins parsen document-referenties + wetten + ECLI's
3. **SourcesPopup** — klikbare bronnenlijst die document in FileViewer opent

---

## 12. Loading States & Animaties

### AssistantChatMessage loading state

Wanneer `loading=true`:
- **Profielfoto:** `ProfilePictureLoading` component (animated spinner)
  - Buitenste cirkel: roteert 360° per 2s (`lm-spin`)
  - Stroke-dash: ademt 0→75→0→75→100 over 4s (`lm-stroke`)
- **Tekst:** "Legal Mind voert een uitgebreide analyse uit"
- **Subtekst:** "Dit process duurt gemiddeld 20 tot 30 seconden"

Wanneer `loading=false`:
- **Profielfoto:** Statisch zwart cirkel met wit Legal Mind logo
- **Tekst:** ReactMarkdown output
- **Bij error:** Rode rand (2px) om profielfoto

**`onTypingComplete` callback:** AssistantChatMessage heeft een `onTypingComplete` prop.
Wordt aangeroepen wanneer het bericht klaar is met typen. Momenteel alleen gebruikt in
de Typing component, niet actief in de chat flow.

### CaseChatLoading (Case module specifiek)

```
Component: CaseChatLoading → CaseChatLoadingInner
Bestand: components/case-management/CaseChatLoading.tsx
```

- Toont als: `!hasReceivedFirstText && isStreaming`
- Roterende subtitels via `useScrollingSubtitle` hook:
  1. "Analyseren van de vraag" (15s duration)
  2. "Document lezen" (10s)
  3. "Document verwerken" (10s)
  4. "Subvraag maken" (10s)
  5. Daarna loopt het rond (loop=true)
- Elapsed time badge: cirkel met secondenteller (1s interval)
- Verdwijnt zodra eerste text-token binnenkomt (`hasReceivedFirstText = true`)

### hasReceivedFirstText tracking (Case/DocCaseChat)

```typescript
// Dual tracking: ref voor synchrone checks, state voor React renders
const hasReceivedFirstTextRef = useRef(false);
const [hasReceivedFirstText, setHasReceivedFirstText] = useState(false);

// Bij eerste text-token:
if (!hasReceivedFirstTextRef.current) {
    hasReceivedFirstTextRef.current = true;
    setHasReceivedFirstText(true);
}

// Reset bij nieuwe vraag:
hasReceivedFirstTextRef.current = false;
setHasReceivedFirstText(false);
```

---

## 13. Error Handling per State

### Assistant Module

| Wanneer | Wat gebeurt | Component |
|---------|-------------|-----------|
| Sessie laden mislukt (404/error) | `assistantSessionError` | `AssistantSessionError` volledig scherm |
| Vraag stellen mislukt (API) | Vraag terug in input, error op bericht | `AssistantSessionErrorComponent` inline |
| Stream error ("error" event) | `setMessageErrorById()` → error per bericht | Rode rand + foutmelding |
| Lege sessie (0 berichten, niet streaming, niet loading) | "De chat is leeg, maak een nieuwe chat" | `AssistantSessionError` |
| ReactMarkdown crash | ErrorBoundary vangt op | Fallback error component |

### Case Module

| Wanneer | Wat gebeurt | Component |
|---------|-------------|-----------|
| Geen documenten geselecteerd | Toast: "minimaal één document geselecteerd" | `react-hot-toast` |
| Sessie creatie mislukt | Toast error | Error state |
| Stream error ("error" event) | `setMessageErrorById()` | Inline error per bericht |
| Stream 404 | `isStream404` flag → `setFetchSessionStream(false)` | Stopt streaming |

---

## 14. Zustand Store: Velden & Reset-Gedrag

### AssistantStore

```typescript
// AssistantSlice
query: string                          // Huidige input tekst
sourcesSidebarOpen: boolean            // Bronnen panel open
showChatHistory: boolean               // Historie panel open (XOR met sources)
assistantError: Error | null           // Globale error

// AssistantSessionSlice
sessionMessages: AssistantSessionMessage[]  // Alle Q&A paren
fetchSessionStream: boolean                 // SSE aan/uit
currentVisibleMessageIndex: number | null   // Welk bericht is zichtbaar (scroll)
sessionError: Error | null                  // Sessie-specifieke error
pendingQuestions: string[]                  // Wachtende vragen

// AssistantSourceModalSlice
sourceModalType: 'law' | 'eurlex' | null
selectedLaw: AnswerLaw | null
selectedEurlex: AnswerEurlex | null

// CommonSourcesSlice (GEPERSISTEERD via Zustand persist)
sourcesEnabled: boolean
selectedSources: SelectedSource[]
```

### Reset bij newQuestionCleanup()

Wordt aangeroepen bij: navigatie sessie→sessie, nieuwe sessie

Reset: `sessionMessages=[], pendingQuestions=[], fetchSessionStream=false, showSources=false,
currentVisibleMessageIndex=null, sessionError=null, sourceModalType=null, selectedLaw=null,
selectedEurlex=null`

Behoudt: `query, sourcesEnabled, selectedSources, historyOpen, sourcesSidebarOpen`

### CaseStore

```typescript
// CaseSessionSlice
sessionMessages: CaseSessionMessage[]
backendMsgIdToPairIndex: number[]         // Backend→frontend ID mapping
fetchSessionStream: boolean
sessionSources: { documents, laws, verdicts }  // SESSIE-BREED
currentVisibleMessageIndex: number | null
isPendingFirstQuestion: boolean

// CaseDocumentTabSlice
selectedFileIds: string[]
currentFolderId: string | null
```

---

## 15. ALLE Timing-Constanten (volledig)

### Assistant Module

| Constante | Waarde | Bestand:Regel | Waarom |
|-----------|--------|---------------|--------|
| scrollToBottom na onMutate | **100ms** | AssistantSession:227-229 | Wacht op React render |
| checkAndScroll na "done" | **100ms** | AssistantSession:181-183 | Laatste scroll |
| scrollToBottom na session load | **100ms** | AssistantSession:331-337 | Scroll na data laden |
| refetchSessionDataDelayed | **500ms** | AssistantSession:145-148 | Backend sync |
| staleTime sessie query | **60000ms** (1 min) | AssistantSession:135 | Cache duur |
| near-bottom threshold | **40px** | AssistantSession:311 | Scroll-hervat drempel |

### Case Module (RightContentSession)

| Constante | Waarde | Bestand:Regel | Waarom |
|-----------|--------|---------------|--------|
| scrollToBottom na onMutate | **100ms** | RightContentSession:262-264 | Wacht op React render |
| checkAndScroll na "done" | **100ms** | RightContentSession:326-328 | Laatste scroll |
| scrollToBottom na message send | **100ms** | RightContentSession:474-476 | Na versturen |
| scrollToBottom na session load | **100ms** | RightContentSession:522-528 | Scroll na data |
| refetchSessionDataDelayed | **1000ms** | RightContentSession:200-202 | Backend sync (LANGER dan assistant!) |
| near-bottom threshold | **20px** | default in hook | Scroll-hervat drempel |

### DocCaseChat (oudere implementatie)

| Constante | Waarde | Waarom |
|-----------|--------|--------|
| checkAndScroll per token | **0ms** (setTimeout 0) | Next-tick, geen delay |
| scrollToBottom na send | **0ms** (setTimeout 0) | Next-tick, geen delay |
| Input visibility delay | **300ms** | Na highlight creation |

### useStreamingAutoScroll Hook

| Constante | Waarde | Waarom |
|-----------|--------|--------|
| checkAndScroll throttle | **100ms** | Max 1 scroll per 100ms |
| programmatic scroll flag reset | **500ms** | Voorkomt false scroll-up detectie |
| `behavior: "smooth"` | **UITGECOMMENT** | Performance tijdens streaming |

### ChatArea Mount Scroll

| Constante | Waarde | Waarom |
|-----------|--------|--------|
| scrollTo behavior | **"smooth"** (WEL actief) | Vloeiende scroll bij mount |

### CSS/Animatie

| Constante | Waarde | Waarom |
|-----------|--------|--------|
| message fade-in | **300ms** ease-out | Smooth verschijning |
| sidebar transition | **400ms** ease-in-out | Slide in/out |
| tooltip hideDelay | **125ms** | Voorkomt flicker |
| ProfilePictureLoading spin | **2s** per rotatie | Loading indicator |
| ProfilePictureLoading stroke | **4s** per cyclus | Breathing effect |
| typing dots animatie | **1.8s** infinite | 3-dot bounce |
| typing dots stagger | **200/300/400ms** delay | Golfbeweging |

---

## 16. ALLE useEffect hooks die scroll/timing beïnvloeden

### AssistantSession.tsx

```typescript
// 1. Invalidate query bij sessionId wijziging
useEffect(() => { queryClient.invalidateQueries(["assistantSession", sessionId]); }, [sessionId]);

// 2. Session data verwerken → bepaalt fetchSessionStream
useEffect(() => {
    if (sessionData.status === "completed") setFetchSessionStream(false);
    else if (sessionData.status === "processing") setFetchSessionStream(true);
    else if (sessionData.status === "streaming") setFetchSessionStream(true);
    // etc
}, [sessionData, sessionId]);

// 3. Auto-scroll hook setup
const { scrollToBottom, checkAndScroll } = useStreamingAutoScroll({ containerRef, isStreaming, threshold: 40 });

// 4. Clear query on mount
useEffect(() => { setQuery(""); }, [setQuery]);

// 5. Store session in sessionStorage
useEffect(() => { sessionStorage.setItem(LAST_SESSION_ID_KEY, sessionId); }, [sessionId]);

// 6. ⭐ Scroll na session load
useEffect(() => { if (!isSessionLoading) setTimeout(scrollToBottom, 100); }, [isSessionLoading, scrollToBottom]);

// 7. ⭐⭐ PRIMAIRE scroll-driver tijdens streaming
useEffect(() => { if (sessionMessages && isStreaming) checkAndScroll(); }, [sessionMessages, checkAndScroll]);

// 8. Track history panel state
useEffect(() => { if (isLoading && showChatHistory) historyWasOpenRef = true; }, [isLoading, showChatHistory]);

// 9. Restore history panel
useEffect(() => { if (!isLoading && historyWasOpenRef) setShowChatHistory(true); }, [isLoading]);
```

### RightContentSession.tsx

```typescript
// 1. Set session messages from data
useEffect(() => { setSessionMessages(sessionData.messages); }, [sessionData, ...]);

// 2. Reset stream completion flag
useEffect(() => { streamCompletedRef = false; invalidateQueries(); }, [sessionId]);

// 3. Invalidate stream query
useEffect(() => { invalidateQueries(["caseSessionStream", ...]); }, [sessionId]);

// 4. Enable/disable streaming based on status
useEffect(() => {
    if (sessionData.status === "processing"/"streaming") setFetchSessionStream(true);
    else setFetchSessionStream(false);
}, [sessionData, isStream404]);

// 5. ⭐⭐ PRIMAIRE scroll-driver tijdens streaming
useEffect(() => { if (sessionMessages && isStreaming) checkAndScroll(); }, [sessionMessages, isStreaming, checkAndScroll]);

// 6. ⭐ Scroll na session load
useEffect(() => { if (!isSessionLoading) setTimeout(scrollToBottom, 100); }, [isSessionLoading]);
```

### AssistantSessionChatArea.tsx / CaseSessionChatArea.tsx

```typescript
// 1. Message visibility tracking (scroll listener)
useEffect(() => { container.addEventListener("scroll", onChatMessageAreaScroll); }, [scrollContainerRef, callback]);

// 2. ⭐ Smooth scroll to bottom on mount
useEffect(() => { scrollContainerRef.scrollTo({ top: scrollHeight, behavior: "smooth" }); }, [scrollContainerRef]);
// (Case variant: [scrollContainerRef, sessionId])
```

---

## 17. Checklist: Wat kan misgaan

### Bij het toevoegen van een component aan de antwoordflow:

- [ ] **Scroll breekt:** Component dat DOM hoogte verandert TIJDENS streaming → `checkAndScroll()`
  berekent verkeerde positie. Voeg toe BINNEN de bestaande message div.
- [ ] **Haperend streamen:** Component dat bij elke token re-rendert (niet memo'd) → vertraagt
  chat. Gebruik `React.memo()` en selectieve Zustand selectors (`state => state.specificField`).
- [ ] **Scroll springt omhoog:** Component BOVEN berichten dat van grootte verandert →
  scroll positie verschuift. Gebruik `sticky` positioning.
- [ ] **Dubbele tekst bij remount:** `answer_inc` events verwerken zonder `isReplay` check →
  dubbele tekst. Controleer altijd `if (!isReplay)`.
- [ ] **Bronnen tonen niet:** remark plugins memo'd op `currentMessage.sources` → bronnen
  van ander bericht tonen niet. Check `currentVisibleMessageIndex`.
- [ ] **Interaction buttons tijdens streaming:** Tonen ALLEEN als `!isStreaming || index !== lastIndex`.
- [ ] **State niet opgeruimd:** Navigatie zonder `newQuestionCleanup()` → vorige berichten zichtbaar.
- [ ] **useEffect scroll loop:** Als je iets toevoegt dat `sessionMessages` wijzigt → triggert
  scroll useEffect. Zorg dat dit niet in een infinite loop belandt.

### Bij het wijzigen van scroll-gedrag:

- [ ] **`behavior: "smooth"` is UITGECOMMENT in de hook.** Dit is bewust voor performance.
  De ChatArea mount-scroll WEL smooth. Niet verwarren.
- [ ] **Throttle niet verlagen onder 100ms.** Veroorzaakt layout thrashing.
- [ ] **500ms programmatic flag.** Pas aan als je scroll-animatie verandert.
- [ ] **Case module refetch is 1000ms, assistant is 500ms.** Respecteer dit verschil.

### Bij het toevoegen van vervolgvragen-component:

- [ ] ONDER het laatste antwoord, BINNEN de berichten-map
- [ ] `scrollToBottom()` NADAT component gerenderd is (setTimeout 100ms)
- [ ] NIET re-renderen bij elke streaming token (memo!)
- [ ] Zelfde `!mt-20` spacing als reguliere Q&A paren
- [ ] Alleen tonen als `!isStreaming` (na antwoord klaar)

---

## 18. Verschil Assistant vs Case Module

| Aspect | Assistant | Case |
|--------|-----------|------|
| SSE Event voor tekst | `"answer"` + `"answer_inc"` | `"text"` |
| Bronnen scope | Per bericht | Per sessie + per bericht |
| Document tracking | Geen | `label_dict` per bericht |
| msg_id routing | Direct: `findOrCreateMessageById(msg_id, ...)` | Complex: `getPairIndexForStreamAnswer()` + `resolveStreamTargetPairIndex()` |
| Eerste token detectie | Implicit (answer wordt non-null) | Explicit: `hasReceivedFirstText` ref+state |
| Loading component | `AssistantChatMessage` met `loading=true` | `CaseChatLoading` met timer en roterende teksten |
| Bron-display in tekst | `remark` plugins | `remark` + `rehype` plugins + document labels |
| Bron klikken | Law → modal, ECLI → nieuw tab, Eurlex → modal | Document → FileViewer, Law → modal, ECLI → nieuw tab |
| Export | SessionDownload | ExportSessionModal (DOCX) |
| Sessie-navigatie | URL path `/assistant/:sessionId` | URL param `?session=:sessionId` |
| Store persistentie | Ja (sourcesEnabled, selectedSources) | Nee |
| Sidebar mutual exclusion | Ja (history XOR sources) | Nee |
| refetchDelay na stream | **500ms** | **1000ms** |
| Near-bottom threshold | **40px** | **20px** |
| SSE enabled guard | Geen `!isAskingQuestion` | WEL `!isAskingQuestion` |
| `translate="no"` | Ja, tijdens streaming | Niet aangetroffen |

---

## 19. CSS Animaties (volledig)

### Gedefinieerd in globals.css / global.scss / tailwind.config.js

```css
/* Bericht verschijning */
fadeIn: 0.3s ease-out (opacity 0→1)
fade-in: 0.3s ease-out (opacity 0→1 + translateY 10px→0)    /* Tailwind variant */
slideUpIn: 0.3s ease-out (translateY 20px→0 + opacity 0→1)
fadeInScale: 0.3s ease-out (scale 0.98→1 + opacity 0→1)
slideInLeft: 0.3s ease-out (translateX -10px→0 + opacity 0→1)

/* Sidebar */
transition-all duration-400 ease-in-out (mr-[-100%] → mr-0)

/* Loading indicators */
lm-spin: 2s linear infinite (360° rotatie)
lm-stroke: 4s linear infinite (stroke-dashoffset pulsatie)
mercuryTypingAnimation: 1.8s ease-in-out infinite (3 dots bounce, stagger 200/300/400ms)
shimmer: lineaire gradient sweep (loading bar)

/* Modals */
modalOpen: 0.3s (scale 0.95→1 + translateY 10px→0)

/* Overig */
expandShrink: 0.5s ease-in-out (scale 0.8→1.1→1)
slideIn: 0.5s ease-out (translateY -20px→0)
blink-favorite: kleur pulsatie
pulse-delete: achtergrond/rand pulsatie
```

---

## 20. Inactieve/Voorbereide Componenten

### FollowUpPopup

**Bestand:** `components/assistant/FollowUpPopup.tsx`
**Status:** BESTAAT maar is UITGECOMMENT in Response.tsx (import gecomment op regel 5)

```typescript
// Toont: "Het is nu mogelijk om vervolgvragen te stellen! Probeer het zelf uit!"
// Positie: absolute, bottom-[80px], horizontaal gecentreerd
// Heeft onClose callback
```

Dit component is klaar om geactiveerd te worden maar niet in gebruik.

### Typing component

**Bestand:** `components/chat/Typing.tsx`
**Status:** Beschikbaar, heeft geavanceerde features

- Per-woord typing met configureerbare snelheid
- `onTypingComplete` callback
- Loop capability
- Delete-on-complete
- Pause-on-hover

Wordt niet actief gebruikt in de huidige streaming flow (streaming toont direct
via ReactMarkdown, niet via typing-animatie).

---

## 21. Bestanden-Referentie

### SSE & Streaming

| Bestand | Doel |
|---------|------|
| `hooks/sseUtils.ts` | Core SSEStreamManager class, global registry |
| `hooks/useSSEQuery.ts` | GET-based streaming hook |
| `hooks/useSSEMutation.ts` | POST-based streaming hook |
| `hooks/useStreamingAutoScroll.ts` | Intelligent auto-scroll tijdens streaming |

### Assistant Module

| Bestand | Doel |
|---------|------|
| `pages/AssistantNew.tsx` | Nieuwe sessie aanmaken |
| `pages/AssistantSession.tsx` | Hoofd chat pagina, SSE setup, mutation handlers |
| `components/assistant/session/AssistantSessionChatArea.tsx` | Berichten renderen met markdown |
| `components/assistant/session/AssistantSessionTopBar.tsx` | Sticky top bar |
| `components/assistant/MainQueryInput.tsx` | Vraag input component |
| `components/assistant/session/MessageInteractionButtons.tsx` | Copy, export, etc. |
| `components/assistant/session/ShowSourcesButton.tsx` | Bronnen sidebar toggle |
| `components/assistant/sources/SourcesSidebar.tsx` | Bronnen panel |
| `components/assistant/session/modals/AssistantSourceModal.tsx` | Law/Eurlex detail modal |
| `components/assistant/session/parsedSources/Ecli.tsx` | ECLI inline component |
| `components/assistant/session/parsedSources/Law.tsx` | Wet inline component |
| `components/assistant/session/parsedSources/EurLex.tsx` | EU wet inline component |
| `components/assistant/FollowUpPopup.tsx` | Vervolgvragen popup (INACTIEF) |
| `components/assistant/LoadingAnimationPopup.tsx` | Loading animatie met progress bar |
| `stores/assistant/assistantStore.ts` | Combined Zustand store |
| `stores/assistant/assistantSlice.ts` | UI state (query, sidebars) |
| `stores/assistant/assistantSessionSlice.ts` | Berichten, streaming, bronnen |
| `stores/assistant/assistantSourceModalSlice.ts` | Modal state |
| `hooks/useRecentAssistantSession.ts` | Auto-navigate naar recente sessie (30 min window) |
| `lib/api/assistant.ts` | API calls |

### Case/Dossier Module

| Bestand | Doel |
|---------|------|
| `pages/Case.tsx` | Hoofd case pagina |
| `components/case/RightContentEmpty.tsx` | Eerste vraag, sessie creatie |
| `components/case/RightContentSession.tsx` | Actieve sessie, SSE setup (NIEUW) |
| `components/case/session/CaseSessionChatArea.tsx` | Berichten renderen |
| `components/case/session/CaseMessage.tsx` | Individueel bericht met bronnen |
| `components/case/MainQueryInput.tsx` | Case-specifieke input met document chips |
| `components/case-management/CaseChatLoading.tsx` | Loading met timer en roterende tekst |
| `components/DocCaseChat.tsx` | OUDERE case chat implementatie (localStorage-based) |
| `stores/case/caseStore.ts` | Combined Zustand store |
| `stores/case/caseSlice.ts` | UI state |
| `stores/case/caseSessionSlice.ts` | Berichten, streaming |
| `stores/case/caseDocumentTabSlice.ts` | Document selectie |
| `stores/case/caseFileViewerSlice.ts` | Document viewer state |
| `stores/case/caseFileSystemActionsSlice.ts` | File operations modals |

### Gedeelde componenten

| Bestand | Doel |
|---------|------|
| `components/chat/AssistantChatMessage.tsx` | Memo'd bericht component |
| `components/chat/UserChatMessage.tsx` | Gebruiker bericht (rechts, grijs) |
| `components/chat/BaseChatMessage.tsx` | Basis layout voor berichten |
| `components/chat/ProfilePictureLoading.tsx` | Animated spinner profielfoto |
| `components/chat/Typing.tsx` | Typing animatie (advanced, niet actief in chat) |
| `components/general/AssistantSourceTooltipWrapper.tsx` | Tooltip voor bronnen hover |
| `components/general/ErrorDisplay.tsx` | Error met retry knop |
| `components/ChatSuggestion.tsx` | Voorgestelde vragen component |
| `stores/common/commonSourcesSlice.ts` | Gedeelde bronnen state |
| `stores/common/commonPromptLibrarySlice.ts` | Prompt library state |
| `lib/remark/assistant/eclis.ts` | ECLI parser remark plugin |
| `lib/remark/assistant/laws.ts` | Wet parser remark plugin |
| `lib/remark/assistant/eurlex.ts` | EU wet parser remark plugin |
| `styles/globals.css` | Globale CSS met animatie definities |
| `styles/global.scss` | Extra animatie definities |
| `styles/typing-indicator.scss` | 3-dot typing animatie |
