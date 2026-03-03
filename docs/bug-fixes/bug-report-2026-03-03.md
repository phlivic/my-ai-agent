# Bug Report - March 3, 2026

This document summarizes the bugs fixed on March 3, 2026.

## 1. Reply language setting was not enforced strongly enough

### Symptom
- The preference panel was set to `English`.
- The user sent a Chinese message.
- The assistant still replied in Chinese.

### Root Cause
- The chat layer allowed the model to follow the language of the latest user message too easily.
- Automatic preference inference could also update `languages`, which weakened the meaning of the manual setting.

### Fix
- The reply language setting is now the primary rule.
- The assistant only switches language when the user explicitly requests a switch in the current message.
- Automatic preference inference no longer modifies `languages`.
- The system prompt was strengthened to explicitly require the configured reply language.

### Result
- If the setting is `English`, the assistant replies in English by default.
- If the setting is `Chinese`, the assistant replies in Chinese by default.

## 2. Chat replies could appear cut off

### Symptom
- Some assistant responses stopped mid-sentence and looked incomplete.

### Root Cause
- The model response length was too constrained, which could truncate longer answers.

### Fix
- Increased the chat completion token budget.
- Added runtime date/time context to improve responses to questions such as "What day is it today?"

### Result
- Long replies are less likely to stop early.
- Time-sensitive questions have better grounding.

## 3. Chinese IME input triggered accidental send on Enter

### Symptom
- While using a Chinese input method, pressing `Enter` during character selection sent the message unexpectedly.
- The unfinished Latin letters could also be inserted into the input after the premature send.

### Root Cause
- The input box treated every `Enter` keypress as a send action.
- Composition state from the IME was not checked.

### Fix
- Added IME composition handling with:
  - `onCompositionStart`
  - `onCompositionEnd`
  - `isComposing` checks in the `Enter` handler

### Result
- Pressing `Enter` during Chinese character selection now only confirms the composition.
- Messages are sent only after composition has finished.

## 4. Recommendation language behavior conflicted with reply language settings

### Symptom
- Changing the language preference could interfere with recommendation generation.

### Root Cause
- The same language field was affecting both assistant reply style and recommendation search behavior.

### Fix
- Recommendation search is now fixed to English.
- The preference panel language setting now controls assistant reply language only.

### Result
- Recommendation requests remain stable.
- Reply language remains user-configurable.

## Summary

Fixed areas:
- Reply language priority
- Preference inference boundaries
- Truncated chat responses
- IME-safe message sending
- Separation between reply language and recommendation search language
