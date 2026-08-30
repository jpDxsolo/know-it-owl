#!/bin/bash
# The KIO-12 acceptance path, driven through the same operations the GM
# dashboard sends: create a game, seat players, draw teams, author a
# five-question round including a real picture upload, release the questions in
# order, take both teams' submissions, grade and reveal.
#
#   API_URL=... API_KEY=... ./scripts/gm-flow-check.sh
#
# Both values are printed by `npx sst deploy`; see docs/dev-smoke-test.md.
set -euo pipefail
: "${API_URL:?set API_URL}" "${API_KEY:?set API_KEY}"
qv() { curl -s -X POST "$API_URL" -H "x-api-key: $API_KEY" -H 'Content-Type: application/json' \
        --data-binary "$(jq -nc --arg q "$1" --argjson v "$2" '{query:$q,variables:$v}')"; }
q() { qv "$1" '{}'; }
die() { echo "FAIL: $*"; exit 1; }

G=$(q 'mutation { createGame { gmToken game { id joinCode } } }')
GID=$(echo "$G"|jq -r .data.createGame.game.id); CODE=$(echo "$G"|jq -r .data.createGame.game.joinCode); TOK=$(echo "$G"|jq -r .data.createGame.gmToken)
echo "1. created $CODE"

for i in 1 2 3 4; do q "mutation { joinGame(joinCode:\"$CODE\", playerId:\"kio12-p$i\", displayName:\"Player $i\") { gameId } }" >/dev/null; done
D=$(q "mutation { randomizeTeams(gameId:\"$GID\", gmToken:\"$TOK\", teamCount:2) { gameId game { teams { id } players { id teamId } } } }")
T0=$(echo "$D"|jq -r '.data.randomizeTeams.game.teams[0].id'); T1=$(echo "$D"|jq -r '.data.randomizeTeams.game.teams[1].id')
C0=$(echo "$D"|jq -r --arg t "$T0" '[.data.randomizeTeams.game.players[]|select(.teamId==$t)|.id][0]')
C1=$(echo "$D"|jq -r --arg t "$T1" '[.data.randomizeTeams.game.players[]|select(.teamId==$t)|.id][0]')
echo "2. teams drawn"

# A real PNG through the presigned URL, exactly as the builder does it.
PNG=/tmp/kio12.png
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > $PNG
LEN=$(wc -c < $PNG | tr -d ' ')
U=$(qv 'mutation($g:ID!,$t:String!,$ct:String!,$cl:Int!){ getImageUploadUrl(gameId:$g,gmToken:$t,contentType:$ct,contentLength:$cl){ uploadUrl imageKey } }' \
      "$(jq -nc --arg g "$GID" --arg t "$TOK" --arg ct "image/png" --argjson cl "$LEN" '{g:$g,t:$t,ct:$ct,cl:$cl}')")
URL=$(echo "$U"|jq -r .data.getImageUploadUrl.uploadUrl); KEY=$(echo "$U"|jq -r .data.getImageUploadUrl.imageKey)
CODE_HTTP=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$URL" -H 'Content-Type: image/png' --data-binary @$PNG)
[ "$CODE_HTTP" = "200" ] || die "upload returned $CODE_HTTP"
echo "3. uploaded picture ($LEN bytes)"

QS=$(jq -nc --arg k "$KEY" '[
  {type:"TEXT",text:"Capital of France?",correctAnswers:["Paris"],defaultPoints:1},
  {type:"TEXT",text:"Capital of Norway?",correctAnswers:["Oslo"],defaultPoints:1},
  {type:"TEXT",text:"Capital of Peru?",correctAnswers:["Lima"],defaultPoints:1},
  {type:"TEXT",text:"Capital of Japan?",correctAnswers:["Tokyo"],defaultPoints:1},
  {type:"PICTURE_10",imageKey:$k,correctAnswers:["1","2","3","4","5","6","7","8","9","10"],defaultPoints:1}
]')
R=$(qv 'mutation($g:ID!,$t:String!,$q:[QuestionInput!]!){ createRound(gameId:$g,gmToken:$t,category:"Mixed",questions:$q){ number status questions { number type } } }' \
      "$(jq -nc --arg g "$GID" --arg t "$TOK" --argjson q "$QS" '{g:$g,t:$t,q:$q}')")
echo "$R" | jq -e '.data.createRound.questions|length == 5' >/dev/null || die "round not saved: $(echo "$R"|jq -c .errors)"
echo "4. authored 5 questions (4 text, 1 picture)"

q "mutation { startRound(gameId:\"$GID\", gmToken:\"$TOK\", roundNumber:1) { gameId } }" >/dev/null
# Skipping ahead must be refused; release is strictly sequential.
SKIP=$(q "mutation { releaseQuestion(gameId:\"$GID\", gmToken:\"$TOK\", roundNumber:1, questionNumber:4) { gameId } }" | jq -r '.errors[0].message // "ALLOWED"')
[ "$SKIP" = "ALLOWED" ] && die "a skipped release was allowed"
echo "5. skip refused: $SKIP"
for n in 2 3 4 5; do q "mutation { releaseQuestion(gameId:\"$GID\", gmToken:\"$TOK\", roundNumber:1, questionNumber:$n) { gameId } }" >/dev/null; done
echo "6. released all 5 in order"

ANS='[{questionNumber:1,answers:["Paris"]},{questionNumber:2,answers:["Oslo"]},{questionNumber:3,answers:["Lima"]},{questionNumber:4,answers:["Tokyo"]},{questionNumber:5,answers:["1","2","3","4","5","6","7","8","9","10"]}]'
for P in "$C0" "$C1"; do
  q "mutation { submitAnswers(input:{gameId:\"$GID\",playerId:\"$P\",roundNumber:1,answers:$ANS}) { gameId } }" >/dev/null
done
# The dashboard's submission tracking reads this.
SUBS=$(q "query { roundResults(gameId:\"$GID\", roundNumber:1, gmToken:\"$TOK\") { responses { teamId } } }" | jq -r '[.data.roundResults.responses[].teamId]|unique|length')
[ "$SUBS" = "2" ] || die "expected 2 teams handed in, saw $SUBS"
echo "7. both teams handed in (submission tracking sees $SUBS)"

# A picture question must reach players as a presigned URL, not a raw key.
IMG=$(q "query { game(gameId:\"$GID\") { rounds { questions { number type imageUrl } } } }" | jq -r '.data.game.rounds[0].questions[]|select(.type=="PICTURE_10")|.imageUrl')
echo "$IMG" | grep -q "X-Amz-Signature" || die "picture question had no presigned URL"
echo "8. picture served as a presigned URL"

for R in $(q "query { roundResults(gameId:\"$GID\", roundNumber:1, gmToken:\"$TOK\") { responses { questionNumber teamId answers } } }" | jq -c '.data.roundResults.responses[]'); do
  QN=$(echo "$R"|jq -r .questionNumber); TID=$(echo "$R"|jq -r .teamId); N=$(echo "$R"|jq -r '.answers|length')
  PTS=$(jq -nc --argjson n "$N" '[range($n)|1]')
  qv 'mutation($i:GradeResponseInput!){ gradeResponse(input:$i){ graded } }' \
     "$(jq -nc --arg g "$GID" --arg t "$TOK" --arg tid "$TID" --argjson qn "$QN" --argjson p "$PTS" \
        '{i:{gameId:$g,gmToken:$t,roundNumber:1,questionNumber:$qn,teamId:$tid,points:$p}}')" >/dev/null
done
END=$(q "mutation { endRound(gameId:\"$GID\", gmToken:\"$TOK\", roundNumber:1) { event status } }")
echo "$END" | jq -e '.data.endRound.event == "ROUND_REVEALED"' >/dev/null || die "endRound: $(echo "$END"|jq -c .errors)"
echo "9. round revealed"
echo
echo "GM FLOW PASSED — join code $CODE, game $GID"
echo "GM token: $TOK"
