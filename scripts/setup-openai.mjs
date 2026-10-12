import { readFile, writeFile, rename, chmod, lstat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = fileURLToPath(new URL('../', import.meta.url));

function readHiddenKey() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Run this command in an interactive terminal. The key prompt is hidden.');
  }
  return new Promise((resolveKey, reject) => {
    let value = '';
    const wasRaw = process.stdin.isRaw;
    const finish = error => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(Boolean(wasRaw));
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolveKey(value.trim());
    };
    const onData = chunk => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003' || character === '\u0004') {
          value = '';
          return finish(new Error('Setup cancelled. No key was saved.'));
        }
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (value.length < 513) value += character;
      }
    };
    process.stdout.write('OpenAI API key (input is hidden): ');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

export async function saveOpenAIKey(key, directory = projectDirectory) {
  if (typeof key !== 'string' || !/^sk-[A-Za-z0-9_-]{17,509}$/.test(key)) {
    throw new Error('Enter an OpenAI API key from the API dashboard. No key was saved.');
  }
  const target = resolve(directory, '.env.local');
  let previous = '';
  try {
    if (!(await lstat(target)).isFile()) throw new Error('The local environment path must be a regular file.');
    previous = await readFile(target, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const lines = previous.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?OPENAI_API_KEY\s*=/.test(line));
  while (lines.at(-1) === '') lines.pop();
  const next = [...lines, `OPENAI_API_KEY=${key}`, ''].join('\n');
  const temporary = resolve(directory, `.env.local.setup-${process.pid}-${Date.now()}`);
  try {
    await writeFile(temporary, next, { mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
    await chmod(target, 0o600);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await saveOpenAIKey(await readHiddenKey());
    console.log('Saved the key in .env.local with private file permissions. It was not sent to any service.');
    console.log('Restart the local app with npm run dev. The model is gpt-6-luna.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
