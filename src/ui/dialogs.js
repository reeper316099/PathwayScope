// Small pop-up dialogs used by the Home page: confirm, ask for a text, and "click outside to close".
import { h, setChildren } from './dom.js';

// Lets a click on the dark area OUTSIDE a pop-up close it (Esc already does).
export function closeOnOutsideClick(dialog) {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) dialog.close();
  });
}

// Builds a modal <dialog>, adds it to the page, and removes it again when it closes.
function openModal(children, labelledBy) {
  const dialog = h('dialog', { class: 'modal', 'aria-labelledby': labelledBy });
  setChildren(dialog, ...children);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  closeOnOutsideClick(dialog);
  dialog.showModal();
  return dialog;
}

// Asks "are you sure?"; resolves true only if the user confirms (clicking outside, Esc or Cancel all mean no).
export function confirmDialog({ title, body, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    let answered = false;
    const finish = (value) => {
      answered = true;
      resolve(value);
      dialog.close();
    };
    const dialog = openModal(
      [
        h('h2', { id: 'confirm-title' }, title),
        h('div', { class: 'modal-body' }, body),
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            { class: 'btn secondary', type: 'button', onclick: () => finish(false) },
            'Cancel',
          ),
          h(
            'button',
            { class: danger ? 'btn danger' : 'btn', type: 'button', onclick: () => finish(true) },
            confirmLabel,
          ),
        ),
      ],
      'confirm-title',
    );
    dialog.addEventListener('close', () => {
      if (!answered) resolve(false);
    });
  });
}

// Asks for one line of text. `onSubmit(text)` does the work and may throw an Error whose message is shown under the box.
// Resolves true once it succeeds, or false if the user cancels.
export function promptDialog({ title, label, value = '', confirmLabel = 'Save', onSubmit }) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', {
      type: 'text',
      id: 'prompt-input',
      value,
      maxlength: '60',
      autocomplete: 'off',
      'aria-describedby': 'prompt-error',
    });
    const error = h('p', { id: 'prompt-error', class: 'note warn', role: 'alert', hidden: true });
    const dialog = openModal(
      [
        h('h2', { id: 'prompt-title' }, title),
        h(
          'form',
          {
            onsubmit: async (event) => {
              event.preventDefault();
              try {
                await onSubmit(input.value);
                done = true;
                resolve(true);
                dialog.close();
              } catch (e) {
                error.textContent = e.message;
                error.hidden = false;
              }
            },
          },
          h('label', { for: 'prompt-input' }, label),
          input,
          error,
          h(
            'div',
            { class: 'actions' },
            h(
              'button',
              { class: 'btn secondary', type: 'button', onclick: () => dialog.close() },
              'Cancel',
            ),
            h('button', { class: 'btn', type: 'submit' }, confirmLabel),
          ),
        ),
      ],
      'prompt-title',
    );
    dialog.addEventListener('close', () => {
      if (!done) resolve(false);
    });
    input.focus();
    input.select();
  });
}
