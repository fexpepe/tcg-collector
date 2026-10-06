// Cloudflare Pages Function: /blog/pt/<slug> — a versão em português de um post.
// Tudo mora no paginaDoPost (functions/blog/[slug].js): este arquivo só diz o
// idioma do endereço. Post escrito originalmente em português responde 301 pro
// /blog/<slug>; post sem esta tradução, 302 pra lá.
import { paginaDoPost } from "../[slug].js";

export const onRequestGet = (context) => paginaDoPost(context, "pt");
