const documents = {
	'01-detaljni-opis-programa.txt': 'Izvor detaljnog opisa programa',
	'02-portal-odgovori.txt': 'Odgovori za HAVC-ovu online prijavnicu',
	'03-troskovnik.txt': 'Izvor troškovnika',
	'04-plan-rada-i-indikatori.txt': 'Plan rada i indikatori',
	'05-tim-i-reference.txt': 'Tim i reference',
};

const noteItems = {
	'01-detaljni-opis-programa.txt': 'program-opis',
	'02-portal-odgovori.txt': 'portal-odgovori',
	'03-troskovnik.txt': 'troskovnik',
	'04-plan-rada-i-indikatori.txt': 'plan-rada',
	'05-tim-i-reference.txt': 'tim-reference',
};

const requested = new URLSearchParams(location.search).get('doc') || '';
const title = document.querySelector('#title');
const meta = document.querySelector('#meta');
const content = document.querySelector('#content');

if (!Object.hasOwn(documents, requested)) {
	title.textContent = 'Dokument nije dostupan';
	meta.textContent = 'Odaberite dokument iz prijavne dokumentacije.';
	content.className = 'reader-content reader-error';
} else {
	title.textContent = documents[requested];
	meta.textContent = 'Prikaz za čitanje na telefonu. Izvorni dokument ostaje dostupan u arhivi.';
	const noteTarget = document.querySelector('#reader-notes');
	noteTarget.dataset.noteItem = noteItems[requested];
	noteTarget.dataset.noteTitle = documents[requested];
	fetch(`/prijava/${requested}`, { credentials: 'same-origin' })
		.then((response) => {
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.text();
		})
		.then((text) => {
			content.textContent = text;
			document.title = `${documents[requested]}, HAVC 2027`;
		})
		.catch(() => {
			content.className = 'reader-content reader-error';
			content.textContent = 'Dokument se trenutačno ne može otvoriti. Vratite se na pregled i pokušajte ponovno.';
			meta.textContent = 'Došlo je do pogreške pri učitavanju.';
		});
}
