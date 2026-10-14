# Replaces account ids and CDK deploy-role names.
# Reads log lines on stdin and writes the redacted log on stdout.

function redact_deploy_roles(line) {
  gsub(/cdk-[A-Za-z0-9]+-deploy-role-[0-9]{12}-[A-Za-z0-9-]+/, "<cdk-deploy-role>", line)
  return line
}

function redact_accounts(line, out, rest, start, before, after) {
  out = ""
  rest = line
  while (match(rest, /[0-9]{12}/)) {
    start = RSTART
    before = (start == 1) ? "" : substr(rest, start - 1, 1)
    after = substr(rest, start + RLENGTH, 1)
    if ((before !~ /[0-9]/) && (after !~ /[0-9]/)) {
      out = out substr(rest, 1, start - 1) "<account>"
    } else {
      out = out substr(rest, 1, start + RLENGTH - 1)
    }
    rest = substr(rest, start + RLENGTH)
  }
  return out rest
}

{
  plain = redact_deploy_roles($0)
  plain = redact_accounts(plain)
  print plain
  fflush()
}
