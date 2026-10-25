// Envoi des e-mails par SMTP. Sans SMTP_HOST (développement), les messages s'affichent dans la console.
import { createTransport } from 'nodemailer';

export function creerMessagerie(smtp, { production, journal = console } = {}) {
  const transport = smtp.host
    ? createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
      })
    : null;

  return {
    async envoyer({ a, sujet, texte, pieceJointe }) {
      if (!transport) {
        if (production) journal.error(`SMTP non configuré : e-mail « ${sujet} » non envoyé`);
        else journal.warn(`[SMTP absent] À ${a} : ${sujet}\n${texte}`);
        return;
      }
      await transport.sendMail({
        from: smtp.expediteur,
        to: a,
        subject: sujet,
        text: texte,
        attachments: pieceJointe
          ? [{ filename: pieceJointe.nom, content: Buffer.from(pieceJointe.contenu), contentType: 'application/pdf' }]
          : undefined,
      });
    },
  };
}
