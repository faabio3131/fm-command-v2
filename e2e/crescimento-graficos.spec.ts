import { test } from "@playwright/test";
import { testeTela } from "./helpers/tela-graficos";

test.use({ locale: "pt-BR" });
testeTela({ rota: "/dashboard/growth", metrica: "trial.starts.count", fato: "trial.started", titulo: "Testes gratuitos iniciados", foto: "crescimento", tom: "good" });
