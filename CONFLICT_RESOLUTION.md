# Resolução de conflitos

A ocupação é configurável por rotina.

- `allow`: horários sobrepostos convivem. Encostar o fim de um no início do outro não é sobreposição, porque o intervalo é aberto no fim.
- `conflict`: se o cliente já conhecia a versão do horário ocupado, a operação é rejeitada. Se a versão era desconhecida ou estava desatualizada, abre-se uma disputa. Nem toda sobreposição é conflito.

## Tipos

- `concurrent_edit`: a versão confirmada mudou.
- `delete_vs_edit`: um lado exclui e o outro ainda edita, ou a exclusão parte de uma versão antiga.
- `relocation`: os dois lados moveram o mesmo agendamento.
- `overlap`: a política de disputa encontrou ocupação desconhecida.
- `batch`: um lote de exclusão inclui agendamento alterado ou um conjunto diferente do esperado.

A exclusão em lote tem um identificador próprio e os escopos `one`, `day`, `week` e `month`. A semana começa na segunda-feira, no fuso da rotina.

## Máquina de estados

`open` aceita uma proposta e passa a `proposal_pending`. Quem propôs pode substituir a própria proposta pendente. Outra pessoa precisa recusar antes de contrapor. A recusa volta a `open` e fica registrada. A aceitação só ocorre se a transição for válida; em seguida o servidor confere permissão e versão de novo e aplica a resolução na mesma transação. Se essa conferência falhar, a transação desfaz a disputa e a operação não fica marcada como aplicada.

Ações: manter o servidor, manter a proposta, remarcar, excluir um agendamento ou excluir todos os envolvidos.

Quem propôs não aceita nem recusa a própria proposta quando há mais de um participante. Com uma única pessoa em dois aparelhos, ela pode concluir.

Nenhuma das versões é descartada em silêncio. Quem fica offline durante a conversa recebe a disputa e as propostas no próximo pull.
