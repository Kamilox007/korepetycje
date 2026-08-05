// Kompiluje cv/cv.tex do public/cv.pdf.
//
// Kolejność: latexmk (jeśli działa), w przeciwnym razie pdflatex uruchomiony
// dwukrotnie. MiKTeX dostarcza latexmk jako skrypt Perla, ale bez interpretera,
// więc na Windowsie zwykle wchodzi ścieżka zapasowa. pdflatex jest wbudowany
// w oba dystrybucje i nie ma zewnętrznych zależności.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROBOCZY = resolve('.cv-build');
const ZRODLO = join('cv', 'cv.tex');
const CEL = join('public', 'cv.pdf');
const WYNIK = join(ROBOCZY, 'cv.pdf');

if (!existsSync(ZRODLO)) {
	console.error(`Brak pliku ${ZRODLO}.`);
	process.exit(1);
}

mkdirSync(ROBOCZY, { recursive: true });
mkdirSync('public', { recursive: true });

const uruchom = (polecenie, argumenty) =>
	execFileSync(polecenie, argumenty, { cwd: 'cv', stdio: 'inherit' });

function przezLatexmk() {
	uruchom('latexmk', [
		'-pdf',
		'-interaction=nonstopmode',
		'-halt-on-error',
		`-outdir=${ROBOCZY}`,
		'cv.tex',
	]);
}

function przezPdflatex() {
	// Dwa przebiegi — drugi domyka odwołania wewnętrzne i licznik stron.
	// MiKTeX potrafi zapytać o doinstalowanie pakietu; przy pierwszym
	// uruchomieniu zezwól w oknie dialogowym albo ustaw instalację automatyczną
	// w MiKTeX Console → Settings → "Always install missing packages".
	for (let i = 0; i < 2; i++) {
		uruchom('pdflatex', [
			'-interaction=nonstopmode',
			'-halt-on-error',
			`-output-directory=${ROBOCZY}`,
			'cv.tex',
		]);
	}
}

let zbudowane = false;

try {
	przezLatexmk();
	zbudowane = true;
} catch {
	console.warn('\n[cv] latexmk niedostępny lub zakończony błędem — próbuję pdflatex.\n');
	try {
		przezPdflatex();
		zbudowane = true;
	} catch {
		console.error('\nKompilacja nie powiodła się.');
		console.error(`Log: ${join(ROBOCZY, 'cv.log')}`);
		console.error('Potrzebny pdflatex: MiKTeX (Windows) albo TeX Live (Linux/macOS).');
		process.exit(1);
	}
}

if (!zbudowane || !existsSync(WYNIK)) {
	console.error(`Kompilator zakończył się bez błędu, ale nie ma ${WYNIK}.`);
	process.exit(1);
}

copyFileSync(WYNIK, CEL);
console.log(`\nGotowe: ${CEL}`);
console.log('Pamiętaj o commicie — obraz Dockera nie kompiluje LaTeX-a.');
