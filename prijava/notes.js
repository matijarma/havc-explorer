const noteTargets = [...document.querySelectorAll('[data-note-item]')];
const endpoint = '/prijava/api/notes';

function formatDate(value) {
	return new Intl.DateTimeFormat('hr-HR', {
		dateStyle: 'medium',
		timeStyle: 'short',
	}).format(new Date(value));
}

function createNote(target) {
	const item = target.dataset.noteItem;
	const title = target.dataset.noteTitle || 'Ova stavka';
	if (!item || target.querySelector(':scope > .note-control')) return;

	const control = document.createElement('div');
	control.className = 'note-control';
	control.innerHTML = `
		<button class="note-trigger" type="button" aria-expanded="false">Bilješka <span>0</span></button>
		<section class="note-panel" hidden>
			<p class="note-title">Bilješke: ${title}</p>
			<label>Što treba promijeniti, provjeriti ili doraditi?
				<textarea rows="4" maxlength="5000" placeholder="Napišite konkretnu bilješku za kasniju doradu."></textarea>
			</label>
			<div class="note-actions">
				<button class="button button-primary" type="button">Spremi bilješku</button>
				<p class="note-status" aria-live="polite"></p>
			</div>
			<ol class="note-list"></ol>
		</section>
	`;
	target.append(control);

	const trigger = control.querySelector('.note-trigger');
	const panel = control.querySelector('.note-panel');
	const textarea = control.querySelector('textarea');
	const save = control.querySelector('.button');
	const status = control.querySelector('.note-status');
	const list = control.querySelector('.note-list');

	const render = (notes) => {
		list.replaceChildren();
		for (const note of notes) {
			const row = document.createElement('li');
			const body = document.createElement('p');
			const meta = document.createElement('small');
			body.textContent = note.body;
			meta.textContent = `${formatDate(note.created_at)}${note.author ? ` · ${note.author}` : ''}`;
			row.append(body, meta);
			list.append(row);
		}
		trigger.querySelector('span').textContent = notes.length;
	};

	const load = async () => {
		status.textContent = 'Učitavanje…';
		try {
			const response = await fetch(`${endpoint}?item=${encodeURIComponent(item)}`, { credentials: 'same-origin' });
			if (!response.ok) throw new Error();
			const payload = await response.json();
			render(payload.notes || []);
			status.textContent = '';
		} catch {
			status.textContent = 'Bilješke se trenutno ne mogu učitati.';
		}
	};

	trigger.addEventListener('click', async () => {
		const opening = panel.hidden;
		panel.hidden = !opening;
		trigger.setAttribute('aria-expanded', String(opening));
		if (opening && !panel.dataset.loaded) {
			panel.dataset.loaded = 'true';
			await load();
		}
	});

	save.addEventListener('click', async () => {
		const body = textarea.value.trim();
		if (!body) {
			status.textContent = 'Najprije napišite bilješku.';
			textarea.focus();
			return;
		}
		save.disabled = true;
		status.textContent = 'Spremanje…';
		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ item, body }),
			});
			if (!response.ok) throw new Error();
			const payload = await response.json();
			textarea.value = '';
			status.textContent = 'Bilješka je spremljena.';
			await load();
		} catch {
			status.textContent = 'Bilješka nije spremljena. Pokušajte ponovno.';
		} finally {
			save.disabled = false;
		}
	});
}

for (const target of noteTargets) createNote(target);
