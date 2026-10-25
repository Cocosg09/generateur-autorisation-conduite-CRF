// Paramètres de la structure : à adapter si le RTPA change.
window.CONFIG = {
  rtpa: {
    // Le nom du RTPA n'est pas stocké ici : il le saisit au moment de signer.
    fonction: 'RTPA',
    structure: "DT DE L'ARIEGE",
    // Adresse à laquelle les demandes de signature sont envoyées.
    // Laisser vide pour que le bénévole saisisse le destinataire dans son logiciel de messagerie.
    email: 'rtpa.dt09@croix-rouge.fr',
  },
  // Année affichée dans le titre ("Charte du conducteur - année XXXX"). null = année en cours.
  annee: null,
};
