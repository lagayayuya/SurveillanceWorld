// `node --import ./tests/registre-liens/enregistrer.mjs …`: the hooks of crochets.mjs.
import { register } from "node:module";

register("./crochets.mjs", import.meta.url);
