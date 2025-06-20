import jwt, { JwtPayload, VerifyErrors } from 'jsonwebtoken';
import moment, { Moment } from 'moment';
import httpStatus from 'http-status';
import config from '../config/env.config';
import * as userService from './user.service';
import Token, { IToken } from '../models/token.model';
import ApiError from '../utils/ApiError';
import { tokenTypes } from '../config/tokens.config';
import { Types } from 'mongoose';
import { IUser } from '../models/user.model'; // Adjust import as needed

type ObjectId = Types.ObjectId | string;

interface AuthTokens {
  access: {
    token: string;
    expires: Date;
  };
  refresh: {
    token: string;
    expires: Date;
  };
}

/**
 * Generate token
 * @param {ObjectId} userId
 * @param {Moment} expires
 * @param {string} type
 * @param {string} [secret]
 * @returns {string}
 */
const generateToken = (
  userId: ObjectId,
  expires: Moment,
  type: string,
  secret: string = config.jwt.secret
): string => {
  const payload = {
    sub: userId,
    iat: moment().unix(),
    exp: expires.unix(),
    type,
  };
  return jwt.sign(payload, secret);
};

/**
 * Save a token
 * @param {string} token
 * @param {ObjectId} userId
 * @param {Moment} expires
 * @param {string} type
 * @param {boolean} [blacklisted]
 * @returns {Promise<ITokenDocument>}
 */
const saveToken = async (
  token: string,
  userId: ObjectId,
  expires: Moment,
  type: string,
  blacklisted = false
): Promise<IToken> => {
  const tokenDoc = await Token.create({
    token,
    user: userId,
    expires: expires.toDate(),
    type,
    blacklisted,
  });
  return tokenDoc;
};

/**
 * Verify token and return token doc (or throw an error if it is not valid)
 * @param {string} token
 * @param {string} type
 * @returns {Promise<ITokenDocument>}
 */
const verifyToken = (token: string, type: string): Promise<IToken> => {
  return new Promise((resolve, reject) => {
    jwt.verify(token, config.jwt.secret, (error: VerifyErrors | null, payload: JwtPayload | string | undefined) => {
      if (error) {
        if (error.name === 'JsonWebTokenError') {
          reject(new ApiError(httpStatus.UNAUTHORIZED, 'Invalid token'));
        } else if (error.name === 'TokenExpiredError') {
          reject(new ApiError(httpStatus.UNAUTHORIZED, 'Token expired'));
        } else {
          reject(new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Internal server error'));
        }
      } else if (payload && typeof payload !== 'string' && (payload as JwtPayload).sub) {
        Token.findOne({ token, type, user: (payload as JwtPayload).sub, blacklisted: false })
          .then(tokenDoc => {
            if (!tokenDoc) {
              reject(new ApiError(httpStatus.NOT_FOUND, 'Token not found'));
            } else {
              resolve(tokenDoc);
            }
          })
          .catch(() => {
            reject(new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Internal server error'));
          });
      } else {
        reject(new ApiError(httpStatus.UNAUTHORIZED, 'Invalid token payload'));
      }
    });
  });
};

/**
 * Generate auth tokens
 * @param {IUserDocument} user
 * @returns {Promise<AuthTokens>}
 */
const generateAuthTokens = async (user: IUser): Promise<AuthTokens> => {
  const accessTokenExpires = moment().add(config.jwt.accessExpirationMinutes, 'minutes');
  const accessToken = generateToken(user.id, accessTokenExpires, tokenTypes.ACCESS);

  const refreshTokenExpires = moment().add(config.jwt.refreshExpirationDays, 'days');
  const refreshToken = generateToken(user.id, refreshTokenExpires, tokenTypes.REFRESH);
  await saveToken(refreshToken, user.id, refreshTokenExpires, tokenTypes.REFRESH);

  return {
    access: {
      token: accessToken,
      expires: accessTokenExpires.toDate(),
    },
    refresh: {
      token: refreshToken,
      expires: refreshTokenExpires.toDate(),
    },
  };
};

/**
 * Generate reset password token
 * @param {string} email
 * @returns {Promise<string>}
 */
const generateResetPasswordToken = async (email: string): Promise<string> => {
  const user = await userService.getUserByEmail(email);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'No users found with this email');
  }
  const expires = moment().add(config.jwt.resetPasswordExpirationMinutes, 'minutes');
  const resetPasswordToken = generateToken(user.id, expires, tokenTypes.RESET_PASSWORD);
  await saveToken(resetPasswordToken, user.id, expires, tokenTypes.RESET_PASSWORD);
  return resetPasswordToken;
};

/**
 * Generate verify email token
 * @param {IUserDocument} user
 * @returns {Promise<string>}
 */
const generateVerifyEmailToken = async (user: IUser): Promise<string> => {
  const expires = moment().add(config.jwt.verifyEmailExpirationMinutes, 'minutes');
  const verifyEmailToken = generateToken(user.id, expires, tokenTypes.VERIFY_EMAIL);
  await saveToken(verifyEmailToken, user.id, expires, tokenTypes.VERIFY_EMAIL);
  return verifyEmailToken;
};

export {
  generateToken,
  saveToken,
  verifyToken,
  generateAuthTokens,
  generateResetPasswordToken,
  generateVerifyEmailToken,
};
