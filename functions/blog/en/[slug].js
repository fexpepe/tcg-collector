// Cloudflare Pages Function: /blog/en/<slug> — a versão em inglês de um post.
// Tudo mora no paginaDoPost (functions/blog/[slug].js): este arquivo só diz o
// idioma do endereço. Post escrito originalmente em inglês responde 301 pro
// /blog/<slug>; post sem esta tradução, 302 pra lá.
import { paginaDoPost } from "../[slug].js";
import { headDoGet } from "../../_lib/borda.js";

export const onRequestGet = (context) => paginaDoPost(context, "en");
export const onRequestHead = headDoGet(onRequestGet);
