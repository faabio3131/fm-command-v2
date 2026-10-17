import { test } from "@playwright/test";
import { testeTela } from "./helpers/tela-graficos";

test.use({ locale: "pt-BR" });
testeTela({ rota: "/dashboard/operations", metrica: "incident.count", fato: "incident.opened", titulo: "Incidentes", foto: "operacoes", tom: "bad" });
