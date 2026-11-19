#!/bin/sh
# Makes sure the secrets exist in the azd environment before provisioning. Generated values are
# never printed; read them with `azd env get-value KLOSS_PASSWORD` (and KLOSS_ADMIN_PASSWORD).
set -e
random() {
  head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"
}
words() {
  # an easy-to-type class password: three short words and a number
  set -- amber brave cedar comet daring falcon garden harbor island lantern maple meadow orchid \
    pebble planet puffin raven river rocket spruce tower tulip valley walrus willow zebra
  n=$#
  pick() { i=$(( $(od -An -N2 -tu2 /dev/urandom) % n + 1 )); eval "printf %s \"\${$i}\""; }
  printf '%s-%s-%s-%s' "$(pick)" "$(pick)" "$(pick)" "$(( $(od -An -N1 -tu1 /dev/urandom) % 90 + 10 ))"
}
# azd exits non-zero for a key it does not have (and prints the error on stdout, so never test the text)
have() { azd env get-value "$1" >/dev/null 2>&1; }

if ! have KLOSS_PASSWORD; then
  azd env set KLOSS_PASSWORD "$(words)" >/dev/null
  echo "Generated KLOSS_PASSWORD (the class password): azd env get-value KLOSS_PASSWORD"
fi
if ! have KLOSS_ADMIN_PASSWORD; then
  azd env set KLOSS_ADMIN_PASSWORD "$(random 24)" >/dev/null
  echo "Generated KLOSS_ADMIN_PASSWORD (for /admin): azd env get-value KLOSS_ADMIN_PASSWORD"
fi
if ! have KLOSS_TOKEN_SECRET; then
  azd env set KLOSS_TOKEN_SECRET "$(random 48)" >/dev/null
fi
