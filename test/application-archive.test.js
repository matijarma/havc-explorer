import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedArchive = [
	'application/01-detaljni-opis-programa.html',
	'application/01-detaljni-opis-programa.pdf',
	'application/02-portal-odgovori.txt',
	'application/03-troskovnik.html',
	'application/03-troskovnik.pdf',
	'application/04-plan-rada-i-indikatori.txt',
	'application/05-tim-i-reference.txt',
];

function git(...args) {
	return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

test('the public application archive contains only approved final submission assets', () => {
	for (const file of expectedArchive) {
		assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
		assert.ok(git('ls-files', '--error-unmatch', file), `${file} must stay tracked`);
	}

	assert.equal(git('ls-files', 'prijava'), '');
	assert.equal(git('check-ignore', '-q', 'prijava/00-podaci-za-potvrdu.txt') || '', '');
	assert.equal(git('check-ignore', '--no-index', '-q', 'application/unapproved-draft.txt') || '', '');
	assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^prijava\/$/m);
	assert.match(fs.readFileSync(path.join(root, '.assetsignore'), 'utf8'), /^prijava\/$/m);
	assert.match(
		fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'),
		/"run_worker_first": \["\/prijava", "\/prijava\/\*"\]/,
	);

	const tracked = git('ls-files');
	assert.deepEqual(
		tracked.split(/\r?\n/).filter((file) => file.startsWith('application/')).sort(),
		expectedArchive,
	);
	for (const forbidden of [
		'prijava/01-detaljni-opis-programa.docx',
		'prijava/03-troskovnik-i-plan-financiranja.xlsx',
		'prijava/project.json',
	]) {
		assert.equal(tracked.includes(forbidden), false, `${forbidden} must not return to the public repository`);
	}
});

test('Croatian archive exposes submitted sources while English uses summaries only', () => {
	const hr = JSON.parse(fs.readFileSync(path.join(root, 'content', 'application.hr.json'), 'utf8'));
	assert.deepEqual(hr.documents.map((document) => document.source), [
		'application/01-detaljni-opis-programa.html',
		'application/02-portal-odgovori.txt',
		'application/03-troskovnik.html',
		'application/04-plan-rada-i-indikatori.txt',
		'application/05-tim-i-reference.txt',
	]);
	assert.equal(hr.documents.find((document) => document.id === 'troskovnik').format, 'budget');
	assert.deepEqual(
		hr.documents.filter((document) => document.pdf).map((document) => document.pdf),
		['application/01-detaljni-opis-programa.pdf', 'application/03-troskovnik.pdf'],
	);

	const en = JSON.parse(fs.readFileSync(path.join(root, 'content', 'application.en.json'), 'utf8'));
	assert.match(en.hero.note, /summary/i);
	assert.deepEqual(en.documents.map((document) => document.id), hr.documents.map((document) => document.id));
	assert.ok(en.documents.every((document) => typeof document.summary === 'string' && document.summary.length > 120));
	assert.ok(en.documents.every((document) => !Object.hasOwn(document, 'source')));
	assert.deepEqual(
		en.documents.filter((document) => document.pdf).map((document) => document.pdf),
		['application/01-detaljni-opis-programa.pdf', 'application/03-troskovnik.pdf'],
	);
});

test('the unrelated legacy domain is absent from public project surfaces', () => {
	const legacyDomain = ['umjetnost', 'zasve'].join('');
	for (const file of [
		'README.md',
		'content/about.hr.json',
		'content/about.en.json',
		'extension-privacy/index.html',
		'content/application.hr.json',
		'content/application.en.json',
	]) {
		assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), new RegExp(legacyDomain, 'i'), file);
	}
});
