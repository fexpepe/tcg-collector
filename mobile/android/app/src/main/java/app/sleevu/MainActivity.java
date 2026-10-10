package app.sleevu;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        desenhaAtrasDasBarras();

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

    // Tela de ponta a ponta em TODO Android, não só no 15+ (2026-10-10).
    //
    // No Galaxy S10 (Android 12, WebView 140+) o app abria com a barra de
    // status cinza e, embaixo dela, uma faixa preta da mesma altura antes do
    // cabeçalho — e a tabbar subia o mesmo tanto acima dos botões do Android.
    // O SystemBars do Capacitor 8, com WebView 140+ e viewport-fit=cover,
    // entrega a altura das barras pra página (--safe-area-inset-*) contando
    // que o WebView está POR BAIXO delas, que é o que o Android 15+ impõe. No
    // 12 a janela ainda nascia encaixada entre as barras: o WebView já
    // começava abaixo da de status e a página somava a altura dela de novo.
    //
    // Soltar a janela das barras (setDecorFitsSystemWindows false) e deixar as
    // duas transparentes faz o Android antigo se comportar como o 15+: com
    // WebView 140+ a página desenha atrás das barras e desconta a altura uma
    // vez só; com WebView mais velho o SystemBars encolhe a tela e o que
    // aparece atrás das barras é o fundo da janela (fundo_app, o escuro do
    // site). Sem o véu de contraste do sistema: ele cobria os botões de
    // navegação de cinza.
    private void desenhaAtrasDasBarras() {
        Window janela = getWindow();
        WindowCompat.setDecorFitsSystemWindows(janela, false);
        janela.setStatusBarColor(Color.TRANSPARENT);
        janela.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            janela.setStatusBarContrastEnforced(false);
            janela.setNavigationBarContrastEnforced(false);
        }
    }
}
