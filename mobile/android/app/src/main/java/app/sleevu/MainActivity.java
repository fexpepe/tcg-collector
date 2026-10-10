package app.sleevu;

import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // O processo que desenha a página (renderer do WebView) pode morrer:
        // falta de memória (o scanner, com câmera e OCR, é o que mais pesa) ou
        // o próprio Android recolhendo memória. Sem ninguém tratar, o
        // Capacitor devolve "não tratei" e o Android ENCERRA o app inteiro —
        // foi o "o app morreu e fechou" do teste no Galaxy S10 (2026-10-10).
        // No Chrome a mesma queda derruba só a aba. Aqui o app recria a tela
        // (WebView novo, de volta ao início) em vez de fechar.
        bridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                    recreate();
                    return true;
                }
            }
        );
    }
}
