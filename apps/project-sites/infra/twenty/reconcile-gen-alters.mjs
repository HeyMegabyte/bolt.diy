import fs from 'fs';

// Tables that actually exist in the core schema (from the DB query).
const existing = new Set(`agent agentChatThread agentMessage agentMessagePart agentTurn agentTurnEvaluation apiKey appToken application applicationRegistration applicationRegistrationVariable applicationVariable approvedAccessDomain calendarChannel commandMenuItem connectedAccount dataSource emailingDomain featureFlag fieldMetadata fieldPermission file frontComponent indexFieldMetadata indexMetadata keyValuePair logicFunction logicFunctionLayer messageChannel messageFolder navigationMenuItem objectMetadata objectPermission pageLayout pageLayoutTab pageLayoutWidget permissionFlag postgresCredentials publicDomain role roleTarget rowLevelPermissionPredicate rowLevelPermissionPredicateGroup searchFieldMetadata signingKey skill twoFactorAuthenticationMethod upgradeMigration user userWorkspace view viewField viewFieldGroup viewFilter viewFilterGroup viewGroup viewSort webhook workspace workspaceSSOIdentityProvider`.split(' '));

const typeMap = {
  uuid: 'uuid', varchar: 'character varying', text: 'text', boolean: 'boolean',
  timestamptz: 'timestamp with time zone', timestamp: 'timestamp with time zone',
  integer: 'integer', int: 'integer', double: 'double precision', float: 'double precision',
  numeric: 'numeric', decimal: 'numeric', jsonb: 'jsonb', json: 'jsonb', bytea: 'bytea',
  date: 'date',
};

const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
const stmts = [];
for (const line of lines) {
  const [table, colsCsv] = line.split('\t');
  if (!existing.has(table) || !colsCsv) continue;
  for (const pair of colsCsv.split(',')) {
    const idx = pair.lastIndexOf(':');
    const col = pair.slice(0, idx);
    const t = pair.slice(idx + 1);
    if (t === 'enum') continue;        // enum cols need their pg enum type; skip
    const pgType = typeMap[t];
    if (!pgType || !col) continue;
    stmts.push(`ALTER TABLE core."${table}" ADD COLUMN IF NOT EXISTS "${col}" ${pgType}`);
  }
}
fs.writeFileSync(process.argv[3], JSON.stringify(stmts, null, 0));
console.log('statements:', stmts.length);
