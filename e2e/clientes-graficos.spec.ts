import { test } from "@playwright/test";
import { testeTela } from "./helpers/tela-graficos";

test.use({ locale: "pt-BR" });
testeTela({ rota: "/dashboard/customers", metrica: "usage.active_users.dau", fato: "usage.active_user.day", titulo: "Usuários ativos diários (DAU)", foto: "clientes", tom: "good" });
