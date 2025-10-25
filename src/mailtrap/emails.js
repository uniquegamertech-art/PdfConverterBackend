import { VERIFICATION_EMAIL_TEMPLATE, WELCOME_EMAIL_TEMPLATE,PASSWORD_RESET_REQUEST_TEMPLATE,PASSWORD_RESET_SUCCESS_TEMPLATE } from "./emailTemplates.js";
import { client, sender } from "./mailtrap.config.js";

export const sendVerificationEmail =  async  (email,verificationToken) => {
    const recipients = [{email}];
    try {
        const response = await client.send({
          from: sender,
          to: recipients,
          subject: "Verify your Email",
          html: VERIFICATION_EMAIL_TEMPLATE.replace(
            "{verificationCode}",
            verificationToken
          ),
          category: "Email Verification",
        });
        console.log("Email sent successfully",response)
    } catch (error) {
      console.error("Error sending verification email :", error);
        throw new Error(`Error sending verification email : ${error}`);
        
    }

};
export const sendWelcomeEmail = async (email, name) => {
	const recipient = [{ email }];

	try {
		const response = await client.send({
			from: sender,
			to: recipient,
			subject: "Verify your Email",
          html: WELCOME_EMAIL_TEMPLATE,
          category: "Email Verification",
		});

		console.log("Welcome email sent successfully", response);
	} catch (error) {
		console.error(`Error sending welcome email`, error);

		throw new Error(`Error sending welcome email: ${error}`);
	}
}
export const sendPasswordResetEmail = async (email, resetURL) => {
	const recipient = [{ email }];

	try {
		const response = await client.send({
			from: sender,
			to: recipient,
			subject: "Reset your password",
			html: PASSWORD_RESET_REQUEST_TEMPLATE.replace("{resetURL}", resetURL),
			category: "Password Reset",
		});
	} catch (error) {
		console.error(`Error sending password reset email`, error);

		throw new Error(`Error sending password reset email: ${error}`);
	}
};
export const sendResetSuccessEmail = async (email) => {
	const recipient = [{ email }];

	try {
		const response = await client.send({
			from: sender,
			to: recipient,
			subject: "Password Reset Successful",
			html: PASSWORD_RESET_SUCCESS_TEMPLATE,
			category: "Password Reset",
		});

		console.log("Password reset email sent successfully", response);
	} catch (error) {
		console.error(`Error sending password reset success email`, error);

		throw new Error(`Error sending password reset success email: ${error}`);
	}
};