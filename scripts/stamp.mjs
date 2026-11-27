// 배포용 캐시 무효화: 파일 내용 해시를 index.html의 import map·링크에 ?v=로 적는다.
// 휴대폰이 새 index.html을 받고도 예전 JS를 캐시에서 쓰는 문제를 막는다(파일이 바뀌면 주소가 바뀜).
//   node scripts/stamp.mjs          → index.html 갱신
//   node scripts/stamp.mjs --check  → 갱신이 필요하면 실패 (npm test에서 사용)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const hash = (path) => createHash('sha1').update(readFileSync(root + path)).digest('hex').slice(0, 8);
const ver = (path) => `${path}?v=${hash(path)}`;

const js = readdirSync(root + 'js').filter((f) => f.endsWith('.js')).sort().map((f) => 'js/' + f);
const map = { imports: Object.fromEntries(js.map((p) => ['./' + p, './' + ver(p)])) };
const block = `<!-- stamp:start (node scripts/stamp.mjs 가 자동 생성) -->
  <script type="importmap">${JSON.stringify(map)}</script>
  <link rel="stylesheet" href="${ver('css/style.css')}">
  <!-- stamp:end -->`;

const htmlPath = root + 'index.html';
const html = readFileSync(htmlPath, 'utf8');
const re = /<!-- stamp:start[\s\S]*?<!-- stamp:end -->/;
if (!re.test(html)) throw new Error('index.html에 stamp 표시가 없어요.');
let next = html.replace(re, block);
next = next.replace(/<script type="module" src="js\/boot\.js[^"]*"><\/script>/, `<script type="module" src="${ver('js/boot.js')}"></script>`);

if (process.argv.includes('--check')) {
  if (next !== html) {
    console.error('index.html의 파일 버전이 최신이 아니에요. `npm run stamp`를 실행한 뒤 커밋해 주세요.');
    process.exit(1);
  }
} else if (next !== html) {
  writeFileSync(htmlPath, next);
  console.log('index.html 버전 갱신');
} else {
  console.log('index.html 버전이 이미 최신이에요.');
}
