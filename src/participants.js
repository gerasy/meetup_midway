import { MAX_PARTICIPANTS } from './constants.js';
import { initializeStationSearchInputs } from './gtfsProcessing.js';

const LABELS = ['A', 'B', 'C', 'D', 'E'];
const MIN_PARTICIPANTS = 2;

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

    const actions = document.createElement('div');
    actions.className = 'person-group-actions';

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'remove-person';
    removeButton.textContent = 'Remove';
    removeButton.setAttribute('data-remove-person', '');

    actions.appendChild(removeButton);
    wrapper.appendChild(actions);

    return wrapper;
}

function updateAddButtonState(button) {
    if (!button) {
        return;
    }
    button.disabled = getCurrentCount() >= MAX_PARTICIPANTS;
}

function updateGroupLabels(container) {
    const groups = Array.from(container.querySelectorAll('.person-group'));
    groups.forEach((group, idx) => {
        const label = LABELS[idx] || String.fromCharCode(65 + idx);
        group.dataset.personGroup = label;

        const labelEl = group.querySelector('label');
        const input = group.querySelector('input[data-person-input]');
        const datalist = group.querySelector('datalist');

        const inputId = `person-${label}`;
        const listId = `${inputId}-stations`;

        if (labelEl) {
            labelEl.setAttribute('for', inputId);
            labelEl.textContent = `Person ${label} Starting Station:`;
        }

        if (input) {
            input.id = inputId;
            input.dataset.personLabel = label;
            input.setAttribute('list', listId);
        }

        if (datalist) {
            datalist.id = listId;
        }
    });
}

function updateRemoveButtons(container) {
    const disable = getCurrentCount() <= MIN_PARTICIPANTS;
    const buttons = container.querySelectorAll('button[data-remove-person]');
    buttons.forEach(btn => {
        btn.disabled = disable;
    });
}

function attachRemoveHandler(group, container, addButton) {
    const button = group.querySelector('button[data-remove-person]');
    if (!button || button.dataset.removeReady === 'true') {
        return;
    }

    button.addEventListener('click', () => {
        if (getCurrentCount() <= MIN_PARTICIPANTS) {
            return;
        }

        group.remove();
        updateGroupLabels(container);
        initializeStationSearchInputs();
        updateAddButtonState(addButton);
        updateRemoveButtons(container);
    });

    button.dataset.removeReady = 'true';
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

    attachRemoveHandler(group, container, button);
    updateGroupLabels(container);
    initializeStationSearchInputs();
    group.querySelector('input')?.focus();
    updateAddButtonState(button);
    updateRemoveButtons(container);
}

export function setupParticipantControls() {
    const container = document.getElementById('peopleInputs');
    const addButton = document.getElementById('addPerson');

    if (!container || !addButton) {
        return;
    }

    updateGroupLabels(container);
    container.querySelectorAll('.person-group').forEach(group => {
        if (!group.querySelector('button[data-remove-person]')) {
            const actions = document.createElement('div');
            actions.className = 'person-group-actions';

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'remove-person';
            removeButton.textContent = 'Remove';
            removeButton.setAttribute('data-remove-person', '');

            actions.appendChild(removeButton);
            group.appendChild(actions);
        }

        attachRemoveHandler(group, container, addButton);
    });

    updateRemoveButtons(container);

    addButton.addEventListener('click', () => addAnotherPerson(container, addButton));
    updateAddButtonState(addButton);
}
