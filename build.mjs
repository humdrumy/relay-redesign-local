import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'styles.css', 'model.mjs', 'app.mjs']) await copyFile(file, `dist/${file}`);
console.log('Built 4 static files in dist/. No dependencies, network calls or credentials.');
