import { register } from 'node:module';
register(new URL('./dist-resolver.mjs', import.meta.url).href);
