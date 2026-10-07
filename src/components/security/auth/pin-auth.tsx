import { Button } from '@/components/common/input/button';
import React, { useState, useEffect, useRef } from 'react';
import { SecurityAction, SecurityManager } from '@/providers/security.provider';
import {cn} from "@/lib/utils.ts";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import { useTranslation } from 'react-i18next';
import {toRecordId} from "@/lib/utils.ts";
import {moduleMatchCandidates} from "@/lib/access.rules.ts";

interface PinAuthProps {
  onSuccess: (manager?: SecurityManager) => void;
  onCancel: () => void;
  currentAction?: SecurityAction | null;
}

export const PinAuth: React.FC<PinAuthProps> = ({ 
  onSuccess, 
  onCancel, 
  currentAction
}) => {
  const { t } = useTranslation('auth');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const db = useDB();
  const submittingRef = useRef(false);
  const pinRef = useRef(pin);
  pinRef.current = pin;

  const handleNumberClick = (num: string) => {
    if (pin.length < 4) {
      setPin(prev => prev + num);
      setError('');
    }
  };

  const handleClear = () => {
    setPin('');
    setError('');
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
    setError('');
  };

  const validatePIN = async () => {
    if (submittingRef.current) return;
    const currentPin = pinRef.current;
    if (currentPin.length !== 4) return;

    submittingRef.current = true;
    setError('');

    const module = currentAction?.module;
    const alternateModule = currentAction?.alternateModule;
    const excludeUserId = currentAction?.excludeUserId
      ? toRecordId(currentAction.excludeUserId)
      : null;
    const moduleCandidates = moduleMatchCandidates(module);
    const alternateCandidates = moduleMatchCandidates(alternateModule);

    // Limit override: Override print limit (any user) OR print module (another user only).
    const useOverrideGate = Boolean(alternateModule && excludeUserId);

    try {
      const [userWithModules] = useOverrideGate
        ? await db.query(
            `SELECT * FROM ${Tables.users}
             WHERE deleted_at = none
               AND (login_method = 'pin' OR login_method = NONE)
               AND login = $pin
               AND crypto::bcrypt::compare(password, $pin) = true
               AND (
                 array::len(array::intersect(user_role.roles ?? [], $overrideModules)) > 0
                 OR (
                   array::len(array::intersect(user_role.roles ?? [], $printModules)) > 0
                   AND id != $excludeUserId
                 )
               )
             FETCH user_role, user_shift`,
            {
              pin: currentPin,
              overrideModules: moduleCandidates,
              printModules: alternateCandidates,
              excludeUserId,
            }
          )
        : await db.query(
            `SELECT * FROM ${Tables.users}
             WHERE deleted_at = none
               AND array::len(array::intersect(user_role.roles ?? [], $modules)) > 0
               AND (login_method = 'pin' OR login_method = NONE)
               AND login = $pin
               AND crypto::bcrypt::compare(password, $pin) = true
             FETCH user_role, user_shift`,
            {
              modules: moduleCandidates,
              pin: currentPin,
            }
          );

      if (userWithModules.length > 0) {
        onSuccess(userWithModules[0] as SecurityManager);
      } else {
        setError(t('security.invalidPin', { module: currentAction?.module }));
      }
    } finally {
      setPin('');
      submittingRef.current = false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await validatePIN();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Enter':
          void validatePIN();
          break;
        case 'Escape':
          onCancel();
          break;
        case 'Backspace':
          setPin(prev => prev.slice(0, -1));
          setError('');
          break;
        default:
          if (/^[0-9]$/.test(e.key)) {
            setPin(prev => {
              if (prev.length >= 4) return prev;
              return prev + e.key;
            });
            setError('');
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentAction, onCancel, onSuccess, t]);

  useEffect(() => {
    if (pin.length === 4) {
      void validatePIN();
    }
  }, [pin]);

  const btnClasses = 'size-[60px] sm:size-[60px] md:size-[90px] p-0 text-neutral-900 transition-all duration-75 bg-neutral-100 rounded-full text-3xl';

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="security-pin-auth">
      <div>
        {error && (
          <div className="my-4 alert alert-danger">{error}</div>
        )}
        
        {/* PIN Dots Display */}
        <div
          data-testid="security-pin-dots"
          className={
          cn("flex justify-center space-x-2 mb-6", !!error && 'login-error')
        }>
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                i < pin.length 
                  ? 'bg-gray-900 border-gray-900' 
                  : 'bg-gray-100 border-gray-300'
              }`}
            >
              {i < pin.length && (
                <div className="w-3 h-3 bg-white rounded-full" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Numeric Keypad */}
      <div className="flex justify-center ">
        <div className="wrapper w-full max-w-[300px] px-2" data-testid="security-pin-pad">
          <div className="grid grid-cols-3 gap-2 sm:gap-5 place-items-center">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
              <button
                key={num}
                type="button"
                onClick={() => handleNumberClick(num)}
                className={btnClasses}
              >
                {num}
              </button>
            ))}
            
            <button
              type="button"
              onClick={handleDelete}
              className={
                cn(btnClasses, 'bg-danger-500 pressable text-white')
              }
            >
              ←
            </button>
            
            <button
              type="button"
              onClick={() => handleNumberClick('0')}
              className={btnClasses}
            >
              0
            </button>
            
            <button
              type="button"
              onClick={handleClear}
              className={
                cn(btnClasses, 'bg-danger-500 pressable text-white')
              }
            >
              C
            </button>
          </div>
        </div>
      </div>

      {/*<div className="mx-auto flex space-x-3 pt-5 w-[400px] mt-5">*/}
      {/*  <Button*/}
      {/*    type="button"*/}
      {/*    onClick={onCancel}*/}
      {/*    variant="secondary"*/}
      {/*    className="flex-1 lg"*/}
      {/*  >*/}
      {/*    Cancel*/}
      {/*  </Button>*/}
      {/*  <Button*/}
      {/*    type="submit"*/}
      {/*    className="flex-1 lg"*/}
      {/*    variant="primary"*/}
      {/*    active*/}
      {/*  >*/}
      {/*    Confirm*/}
      {/*  </Button>*/}
      {/*</div>*/}
    </form>
  );
};
