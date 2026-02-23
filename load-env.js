import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loadEnv = function () {
 const envPath = path.resolve(__dirname, '..', '.env');
 const localPath = path.resolve(__dirname, '.env');
 const target = fs.existsSync(envPath) ? envPath : fs.existsSync(localPath) ? localPath : null;
 if (!target) return;

 const lines = fs.readFileSync(target, 'utf8').split('\n');
 for (const line of lines) {
  if (!line || line.startsWith('#')) continue;
  const [key, ...valueParts] = line.split('=');
  if (key && valueParts.length) {
   process.env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
  }
 }
};

loadEnv();
export default loadEnv;
