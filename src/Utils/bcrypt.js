import bcrypt from 'bcryptjs'
export const hashValue = async (value,saltRounds=10) => 
    bcrypt.hash(value ,saltRounds);


export const compareValue = async (value, hashedValue) =>
  bcrypt.compare(value, hashedValue).catch(()=> false);