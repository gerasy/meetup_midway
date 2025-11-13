import { MAX_PARTICIPANTS } from './constants.js';
import { initializeStationSearchInputs } from './gtfsProcessing.js';

const LABELS = ['A', 'B', 'C', 'D', 'E'];

function getCurrentCount() {
    return document.querySelectorAll('[data-person-input]').length;
}

function createPersonGroup(label) {
    const wrapper = document.createElement('div');
    wrapper.className = 'input-group person-group';
    wrapper.dataset.personGroup = label;

    const labelEl = document.createElement('label');
    const inputId = `person-${label}`;
    labelEl.setAttribute('for', inputId);
    labelEl.textContent = `Person ${label} Starting Station:`;

    const input = document.createElement('input');
    input.type = 'text';
    input.id = inputId;
    input.placeholder = 'e.g., Alexanderplatz';
    input.setAttribute('data-person-input', '');
    input.setAttribute('data-person-label', label);
    input.setAttribute('data-station-input', '');

    const datalist = document.createElement('datalist');
    datalist.id = `${inputId}-stations`;
    input.setAttribute('list', datalist.id);

    wrapper.appendChild(labelEl);
    wrapper.appendChild(input);
    wrapper.appendChild(datalist);

    return wrapper;
}

function updateAddButtonState(button) {
    if (!button) {
        return;
    }
    button.disabled = getCurrentCount() >= MAX_PARTICIPANTS;
}

function addAnotherPerson(container, button) {
    if (!container) {
        return;
    }

    const count = getCurrentCount();
    if (count >= MAX_PARTICIPANTS) {
        updateAddButtonState(button);
        return;
    }

    const label = LABELS[count] || String.fromCharCode(65 + count);
    const group = createPersonGroup(label);
    container.appendChild(group);

    initializeStationSearchInputs();
    group.querySelector('input')?.focus();
    updateAddButtonState(button);
}

export function setupParticipantControls() {
    const container = document.getElementById('peopleInputs');
    const addButton = document.getElementById('addPerson');

    if (!container || !addButton) {
        return;
    }

    addButton.addEventListener('click', () => addAnotherPerson(container, addButton));
    updateAddButtonState(addButton);
}
