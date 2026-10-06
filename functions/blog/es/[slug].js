// Cloudflare Pages Function: /blog/es/<slug> — a versão em espanhol de um post.
// Tudo mora no paginaDoPost (functions/blog/[slug].js): este arquivo só diz o
// idioma do endereço. Post escrito originalmente em espanhol responde 301 pro
// /blog/<slug>; post sem esta tradução, 302 pra lá.
import { paginaDoPost } from "../[slug].js";

export const onRequestGet = (context) => paginaDoPost(context, "es");
