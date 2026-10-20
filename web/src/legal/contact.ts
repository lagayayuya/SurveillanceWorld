// The site's contact address, given by the deploy to the build (deploy.env CONTACT_EMAIL →
// VITE_CONTACT_EMAIL), never in the repository: « Me contacter », « Mot de passe oublié ? »
// and the legal pages write to it. A build without it (the tests) leaves it empty.
export const CONTACT: string = import.meta.env.VITE_CONTACT_EMAIL ?? "";
