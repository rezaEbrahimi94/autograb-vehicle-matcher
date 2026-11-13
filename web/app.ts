import { createApi } from './api.js';
function element<T extends HTMLElement>(id: string, ctor: { new (): T }): T {
  const node = document.getElementById(id);
  if (!(node instanceof ctor)) throw new Error(`Missing page element: ${id}`);
  return node;
}
const input = element('input', HTMLTextAreaElement),
  form = element('form', HTMLFormElement),
  submit = element('submit', HTMLButtonElement),
  message = element('message', HTMLParagraphElement),
  result = element('result', HTMLElement),
  status = element('status', HTMLParagraphElement);
const api = createApi();
let sequence = 0,
  controller: AbortController | undefined;
function clear() {
  sequence++;
  controller?.abort();
  result.hidden = true;
  submit.disabled = false;
  message.textContent = 'Description changed. Select Find vehicle to update the result.';
}
input.addEventListener('input', clear);
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-example]'))
  button.addEventListener('click', () => {
    const example = button.dataset.example;
    if (example !== undefined) {
      input.value = example;
      clear();
    }
  });
async function match() {
  const mine = ++sequence;
  controller?.abort();
  controller = new AbortController();
  submit.disabled = true;
  message.textContent = 'Checking the catalogue…';
  result.hidden = true;
  try {
    const response = await api.match(input.value, controller.signal);
    if (mine !== sequence) return;
    result.replaceChildren();
    const add = (tag: keyof HTMLElementTagNameMap, text: string) => {
      const node = document.createElement(tag);
      node.textContent = text;
      result.append(node);
    };
    add(
      'h2',
      response.vehicle
        ? [response.vehicle.make, response.vehicle.model, response.vehicle.badge].join(' ')
        : 'No vehicle selected',
    );
    add('p', `Vehicle ID: ${response.vehicleId ?? 'null'} · Confidence: ${response.confidence}/10`);
    if (response.vehicle)
      add(
        'p',
        [
          response.vehicle.transmission_type,
          response.vehicle.fuel_type,
          response.vehicle.drive_type,
        ].join(' · '),
      );
    add(
      'p',
      response.needsSemanticReview
        ? 'Review the description and result before relying on this match.'
        : 'The interpreted details are compatible with this record.',
    );
    const details = document.createElement('details'),
      summary = document.createElement('summary');
    summary.textContent = 'Matching explanation';
    details.append(summary);
    const list = document.createElement('ul');
    for (const text of response.notes) {
      const li = document.createElement('li');
      li.textContent = text;
      list.append(li);
    }
    details.append(list);
    result.append(details);
    result.hidden = false;
    message.textContent = 'Complete.';
  } catch (error) {
    if (mine === sequence)
      message.textContent = error instanceof Error ? error.message : 'Matching failed.';
  } finally {
    if (mine === sequence) submit.disabled = false;
  }
}
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void match();
});
void api
  .status()
  .then((response) => {
    status.textContent = response.restartRequired
      ? 'Source or catalogue changed. Restart the app before using results.'
      : `${response.catalogueRows} catalogue vehicles · Connected locally`;
  })
  .catch(() => {
    status.textContent = 'Catalogue unavailable. Check PostgreSQL and restart the app.';
  });
