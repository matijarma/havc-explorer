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

test('both archive manifests expose the same approved document set', () => {
	for (const locale of ['hr', 'en']) {
		const manifest = JSON.parse(fs.readFileSync(path.join(root, 'content', `application.${locale}.json`), 'utf8'));
		const sources = manifest.documents.map((document) => document.source);
		assert.deepEqual(sources, [
			'application/01-detaljni-opis-programa.html',
			'application/02-portal-odgovori.txt',
			'application/03-troskovnik.html',
			'application/04-plan-rada-i-indikatori.txt',
			'application/05-tim-i-reference.txt',
		]);
		assert.deepEqual(
			manifest.documents.filter((document) => document.pdf).map((document) => document.pdf),
			['application/01-detaljni-opis-programa.pdf', 'application/03-troskovnik.pdf'],
		);
	}
});
