# Quran Vocabulary App — Design & UX Fixing Plan

> Status: Proposed design system and UI remediation plan  
> Scope: Existing Vanilla JS / HTML / CSS PWA  
> Goal: A calm, polished, accessible Quran learning experience

## 1. Design principles

1. Clarity before decoration; avoid overcrowded cards.
2. Consistent reusable buttons, cards, badges, dialogs, sheets, fields, and feedback.
3. Arabic-first readability with correct shaping, font, line-height, and spacing.
4. Readable Bengali typography and natural Bengali labels.
5. Light and dark themes must both be intentionally designed.
6. Mobile-first and responsive, with sensible use of wider screens.
7. Accessible keyboard support, visible focus, contrast, semantic markup, reduced motion.
8. Honest loading, offline, empty, error, success, and progress states.

## 2. Existing repository audit findings

Re-check exact locations before editing, as files may change.

### 2.1 Surah list class mismatch

CSS defines:
- `.surah-number`
- `.surah-name-main`
- `.surah-name-meaning`
- `.surah-meta`

The inspected renderer in `js/app.js` uses different names, including:
- `.surah-num`
- `.surah-name-bn`
- `.surah-meaning`
- `.surah-sub-row`

Align generated markup and CSS around one naming convention. Avoid accumulating legacy selector overrides.

### 2.2 Makki / Madani metadata mismatch

The metadata dataset uses `type` values `meccan` and `medinan` (86 and 28 records in the inspected dataset). The renderer checks `revelation_place === 'makkah'`.

Normalize metadata once at the data boundary, e.g. `revelationType: 'makki' | 'madani'`. Render from that normalized field everywhere. Add a test for 86 Makki and 28 Madani entries.

### 2.3 Native browser popup

The inspected `index.html` contains a native `alert()` after successful offline data caching. Search the whole repository and replace application-flow `alert()`, `confirm()`, and `prompt()` with shared custom components.

### 2.4 Modal CSS without reusable component

Modal-related CSS exists, but the inspected `index.html` did not include a reusable modal root. Build a real component and lifecycle rather than adding more one-off overlay markup.

### 2.5 Progress styling not connected

Styles such as `.progress-ring` and `.surah-progress-badge` exist, but the inspected Surah renderer does not appear to use the same structure. Connect progress UI to real user data or remove unused styles.

### 2.6 Inline styles and responsive rules

The inspected `index.html` has multiple inline style attributes. Move reusable presentation into CSS classes/tokens. Review behavior on phones and wider screens.

## 3. Design tokens

Keep `css/theme.css` as the source of truth. Avoid hard-coded colors in feature styles.

### Color roles

Preserve the current emerald + warm gold direction, then validate contrast:
- Primary emerald: primary actions and active learning.
- Warm gold: restrained highlights and secondary emphasis.
- Canvas, surface, raised surface, muted surface.
- Primary and secondary text.
- Subtle and strong borders.
- Semantic success, warning, danger, and info colors.

Do not use color alone to communicate Makki/Madani, correctness, or sync status; pair color with text/icon.

### Typography

Keep existing font direction unless testing reveals an issue:
- Arabic: IndoPak first, existing fallbacks.
- Bengali: Noto Sans Bengali / Hind Siliguri fallback.
- UI: system stack with Bengali fallback.

Define consistent tokens for UI body/small text, Bengali headings, Arabic word/Ayah sizes, Arabic line height, and metadata. Test real Quran text with diacritics and long Ayahs. Do not apply aggressive letter spacing to Arabic.

### Spacing, radius, elevation

Use the existing spacing scale as a baseline. Define a limited scale for radius, card padding, button heights/hit areas, dialog/sheet padding, and shadows. Avoid many near-duplicate values.

### Motion

- Brief interaction feedback.
- Restrained dialog and sheet transitions.
- Smooth but unobtrusive progress transitions.
- Respect `prefers-reduced-motion`.
- Avoid animations that distract from Quran reading or practice.

## 4. Reusable component system

### Buttons
Variants: primary, secondary, ghost, destructive, icon-only. Include consistent touch targets, disabled/loading/hover/pressed/focus states, and icon alignment.

### Badges
Use for Makki/Madani, completion state, offline/sync state, and vocabulary metadata. Keep compact and never rely on color alone.

### Cards
Use consistent patterns for Surah rows, vocabulary, Ayahs, practice modes, and statistics. Predictable hierarchy: title, metadata, optional Arabic, progress/action.

### Form fields
Clear labels/helper text, visible focus, associated errors, touch-friendly size, and password visibility control where appropriate.

## 5. Custom feedback and overlay system

Create a reusable module, for example `js/ui/overlay-manager.js`.

Suggested API:

```js
UIOverlay.alert({
  title: "ডেটা সংরক্ষিত",
  message: "সকল নির্বাচিত ডেটা অফলাইনে সংরক্ষিত হয়েছে।",
  type: "success",
  confirmText: "ঠিক আছে"
});

const confirmed = await UIOverlay.confirm({
  title: "অনুশীলন বন্ধ করবেন?",
  message: "আপনার বর্তমান অগ্রগতি সংরক্ষিত থাকবে।",
  confirmText: "বন্ধ করুন",
  cancelText: "চালিয়ে যান",
  destructive: false
});

UIOverlay.toast({
  message: "বুকমার্কে সংরক্ষিত হয়েছে",
  type: "success"
});
```

Adjust API to fit existing architecture.

### Required overlay types

1. Information/success dialog.
2. Confirmation dialog.
3. Destructive confirmation.
4. Mobile-oriented bottom sheet.
5. Toast for short feedback.
6. Blocking loading overlay only when genuinely necessary.

### Accessibility and behavior

- Semantic dialog markup and `aria-modal`.
- Move focus into dialog, trap focus, restore focus on close.
- Support Escape for dismissible dialogs.
- Consistent backdrop behavior.
- Prevent background scroll while a sheet is open.
- Respect reduced motion.
- Prevent accidental overlay stacking.
- Confirmation returns a reliable Promise/result.
- Never report success before the operation succeeds.
- Announce toasts with an appropriate live region.
- Do not use toast for decisions requiring user input.

## 6. Surah directory redesign

### Header and summary
- Clear title and short subtitle.
- Compact overall learning progress with a labeled progress bar.
- Optional summary metrics: 114 total, 86 Makki, 28 Madani.
- Avoid oversized dashboards that push the list too far down.

### Search and filters
- Search by Surah number, Bengali name, transliteration, and Arabic name when available.
- Clear-search action.
- Filter chips: All, Makki, Madani, optionally learning status.
- Visible filter state and easy reset.
- Useful empty-search state with a clear action.

### Surah row/card
1. Distinct but restrained Surah number tile.
2. Bengali Surah name and meaning/transliteration.
3. Makki/Madani icon plus text badge.
4. Ayah count and optional word count.
5. Arabic Surah name aligned for RTL.
6. Learning progress only when actual progress data exists.

Keep rows compact and make the interaction area clear. Never show invented/placeholder progress.

### Makki / Madani treatment
- Use distinct icons plus text.
- Suggested concepts: landmark/building for Makki and mosque/building for Madani; choose icons supported by the project.
- Use restrained semantic tints, not large saturated blocks.
- Normalize actual metadata values (`meccan` / `medinan`) centrally.
- Verify counts: 86 Makki, 28 Madani.

## 7. Other screen improvements

### Ayah view
- Improve Ayah separation and verse-number presentation.
- Give Arabic text enough line height and breathing room.
- Keep translation visually secondary.
- Make word tokens clearly tappable with selected/playing/focused states.
- Avoid cramped layout and accidental text selection.

### Word detail
- Clear Arabic word focus.
- Bengali meaning and transliteration hierarchy.
- Root, word type, morphology as compact metadata.
- Audio play/loading/error states.
- Concordance and occurrence contexts grouped clearly.
- Consistent bookmark and note actions.

### Practice hub and quiz
- Distinguish Vocabulary Sets, Ayah Practice, Smart Review.
- Show session progress and question count.
- Large, easy-to-tap answer options.
- Correct/incorrect feedback must not rely only on color.
- Avoid dialogs for routine question feedback.
- Clear session summary and next action.
- Preserve session state when appropriate.

### Bookmarks and notes
- Useful empty state with return-to-learning action.
- Search/sorting for long lists.
- Consistent bookmark toggle state.
- Set note text through form element `.value`; never interpolate user notes into HTML.
- Confirm destructive deletion with the custom confirmation component.

### Audio download manager
- Separate Ayah and word audio.
- Per-Surah and overall progress.
- Queued/downloading/complete/paused/failed states.
- Retry/cancel where supported.
- Confirm bulk downloads and explain storage/network impact.
- No native alert on completion.

## 8. Light/dark theme QA

For every screen/component verify text contrast, Arabic readability, borders, muted surfaces, badge legibility, modal/backdrop contrast, focus rings, progress visibility, and disabled states. Do not merely invert colors; preserve hierarchy and visual calm.

## 9. Responsive and accessibility requirements

- Test narrow Android phones, larger phones, tablets, and desktop.
- Keep controls reachable with one hand where practical.
- Respect safe-area insets for bottom navigation and sheets.
- Prevent horizontal overflow.
- Support keyboard navigation and visible focus.
- Use semantic headings, buttons, lists, and labels.
- Give icon-only controls accessible names.
- Maintain readable text and sufficient contrast.
- Test screen-reader announcements for toast, modal, and quiz feedback.
- Respect reduced-motion preference.

## 10. Implementation order

### Phase 1 — Audit and design foundation
- Inventory CSS selectors and generated markup.
- Confirm actual metadata schema.
- Align class naming.
- Consolidate tokens.
- Remove avoidable inline styles.
- Document component variants.

### Phase 2 — Shared UI components
- Button variants, badges, cards, fields.
- Toast manager.
- Dialog and confirmation manager.
- Bottom sheet manager.
- Focus and accessibility handling.

### Phase 3 — Surah directory
- Fix Makki/Madani normalization.
- Fix CSS/renderer mismatch.
- Redesign summary, search, filters, rows, and progress.
- Add loading, empty, and error states.

### Phase 4 — Learning screens
- Ayah view, word detail, audio, bookmarks, notes.

### Phase 5 — Practice experience
- Practice hub, question layouts, answer feedback, session summary, resume/exit confirmation.

### Phase 6 — Polish and QA
- Light/dark parity, responsive and accessibility testing.
- Reduced-motion behavior.
- Remove unused CSS and legacy popup code.
- Verify no app flow still uses native `alert()`, `confirm()`, or `prompt()`.

## 11. Acceptance checklist

### Design foundation
- [ ] Tokens are the source of truth for color, spacing, radius, typography, elevation.
- [ ] Component styles are reusable and consistently named.
- [ ] No unnecessary inline styles are introduced.
- [ ] Light and dark themes pass visual review.

### Surah directory
- [ ] CSS selectors match rendered markup.
- [ ] Makki/Madani labels use normalized metadata.
- [ ] Counts validate to 86 Makki and 28 Madani.
- [ ] Search covers supported names and number.
- [ ] Filters work and can be cleared.
- [ ] Progress uses real user data.
- [ ] Loading, empty, and error states are designed.

### Popups and feedback
- [ ] App flows no longer rely on native alert/confirm/prompt.
- [ ] Modal focus is trapped and restored.
- [ ] Escape/backdrop behavior is consistent.
- [ ] Sheets respect safe areas and background scroll.
- [ ] Toasts are accessible and do not hide critical actions.
- [ ] Destructive actions require confirmation.

### Screens and accessibility
- [ ] Arabic is legible at supported sizes.
- [ ] Bengali labels are readable and consistent.
- [ ] Buttons have suitable touch targets and focus states.
- [ ] No horizontal overflow on supported viewports.
- [ ] Reduced-motion preference is respected.
- [ ] Major states are checked in both themes.

## 12. Implementation rule

Before changing a screen, inspect its HTML generation, CSS, event handling, and data source. Fix root causes rather than layering overrides. After each screen update, test real interactions in both light and dark themes before moving on.
